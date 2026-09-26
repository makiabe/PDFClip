/* Lazy, browser-only PDF processing. PDF bytes never enter a network request. */
(function (root) {
  'use strict';
  const PDFJS_BASE = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38';
  const PDFLIB_URL = 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js';
  const MAX_FILE_BYTES = 100 * 1024 * 1024;
  const core = root.PDFClipCore;
  let dependenciesPromise;
  function abortCheck(signal) {
    if (signal?.aborted) throw new DOMException('処理を中止しました。', 'AbortError');
  }
  function timeout(promise, ms, message) {
    let timer;
    return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); })]).finally(() => clearTimeout(timer));
  }
  function loadScript(url, globalName) {
    if (root[globalName]) return Promise.resolve(root[globalName]);
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      const timer = setTimeout(() => done(new Error('処理ライブラリの読み込みがタイムアウトしました。通信環境をご確認ください。')), 25000);
      function done(error) {
        clearTimeout(timer); script.onload = script.onerror = null;
        if (error) { script.remove(); reject(error); }
        else if (!root[globalName]) { script.remove(); reject(new Error('処理ライブラリを読み込めませんでした。')); }
        else resolve(root[globalName]);
      }
      script.src = url; script.async = true;
      script.onload = () => done();
      script.onerror = () => done(new Error('処理ライブラリを取得できませんでした。通信環境を確認して、もう一度PDFを選択してください。'));
      document.head.append(script);
    });
  }
  function getDependencies() {
    if (!dependenciesPromise) {
      dependenciesPromise = Promise.all([
        loadScript(PDFLIB_URL, 'PDFLib'),
        timeout(import(PDFJS_BASE + '/build/pdf.min.mjs'), 25000, 'PDF表示ライブラリを読み込めませんでした。通信環境をご確認ください。')
      ]).then(([lib, renderer]) => {
        renderer.GlobalWorkerOptions.workerSrc = PDFJS_BASE + '/build/pdf.worker.min.mjs';
        return { lib, renderer };
      }).catch(error => { dependenciesPromise = null; throw error; });
    }
    return dependenciesPromise;
  }
  async function open(file, signal) {
    if (!file || (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf')) throw new Error('PDFファイルを選択してください。');
    if (file.size > MAX_FILE_BYTES) throw new Error('100MBを超えるPDFは扱えません。小さなPDFでお試しください。');
    if (file.size === 0) throw new Error('ファイルが空です。別のPDFを選択してください。');
    const deps = await getDependencies(); abortCheck(signal);
    const bytes = new Uint8Array(await file.arrayBuffer()); abortCheck(signal);
    let source;
    try { source = await deps.lib.PDFDocument.load(bytes, { updateMetadata: false }); }
    catch (error) {
      if (error?.name === 'EncryptedPDFError' || /encrypted/i.test(error?.message || ''))
        throw new Error('パスワード付き・暗号化されたPDFには対応していません。保護を解除したPDFをご用意ください。');
      throw new Error('PDFを読み込めませんでした。ファイルが破損していないかご確認ください。');
    }
    const loadingTask = deps.renderer.getDocument({
      data: bytes.slice(), // PDF.js may transfer this copy to its worker. Keep the original bytes.
      cMapUrl: PDFJS_BASE + '/cmaps/', cMapPacked: true,
      standardFontDataUrl: PDFJS_BASE + '/standard_fonts/',
      isEvalSupported: false, enableXfa: false, verbosity: 0
    });
    const stop = () => { void loadingTask.destroy().catch(() => {}); };
    signal?.addEventListener('abort', stop, { once: true });
    loadingTask.onPassword = stop;
    let documentProxy;
    try { documentProxy = await loadingTask.promise; abortCheck(signal); }
    catch (error) {
      await loadingTask.destroy().catch(() => {});
      abortCheck(signal);
      throw new Error('PDFの表示に失敗しました。暗号化・破損していないPDFかご確認ください。');
    } finally { signal?.removeEventListener('abort', stop); }
    if (!documentProxy.numPages || source.getPageCount() !== documentProxy.numPages) {
      await documentProxy.destroy();
      throw new Error('ページ構成を確認できませんでした。別のPDFでお試しください。');
    }
    return new PdfSession(deps, source, documentProxy, file.name, file.size);
  }
  class PdfSession {
    constructor(deps, source, documentProxy, name, size) {
      this.deps = deps; this.source = source; this.document = documentProxy;
      this.name = name; this.size = size; this.total = documentProxy.numPages; this.closed = false;
    }
    async dispose() {
      this.closed = true; this.source = null;
      await this.document.destroy().catch(() => {});
    }
    async render(pageNumber, additionalRotation, { signal, scale = 2, maxWidth = 4096, maxHeight = 4096, maxPixels = 12000000 } = {}) {
      abortCheck(signal);
      if (this.closed) throw new DOMException('処理を中止しました。', 'AbortError');
      const page = await this.document.getPage(pageNumber); abortCheck(signal);
      const rotation = core.normalizeRotation(page.rotate + additionalRotation);
      const original = page.getViewport({ scale: 1, rotation });
      const fittedScale = Math.min(scale, maxWidth / original.width, maxHeight / original.height, Math.sqrt(maxPixels / (original.width * original.height)));
      const viewport = page.getViewport({ scale: fittedScale, rotation });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.floor(viewport.width)); canvas.height = Math.max(1, Math.floor(viewport.height));
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) throw new Error('画像の描画領域を確保できませんでした。小さなPDFでお試しください。');
      const task = page.render({ canvasContext: context, viewport, background: '#ffffff' });
      const cancel = () => task.cancel();
      signal?.addEventListener('abort', cancel, { once: true });
      try { await task.promise; abortCheck(signal); return canvas; }
      catch (error) { canvas.width = canvas.height = 1; abortCheck(signal); throw error; }
      finally { signal?.removeEventListener('abort', cancel); }
    }
    async pdfBytes(pages, rotationFor, signal) {
      abortCheck(signal);
      const { PDFDocument, degrees } = this.deps.lib;
      const out = await PDFDocument.create();
      out.setCreator('PDF Clip'); out.setProducer('PDF Clip');
      const copies = await out.copyPages(this.source, pages.map(n => n - 1));
      copies.forEach((page, i) => {
        page.setRotation(degrees(core.normalizeRotation(page.getRotation().angle + rotationFor(pages[i]))));
        out.addPage(page);
      });
      abortCheck(signal);
      const bytes = await out.save(); abortCheck(signal); return bytes;
    }
    async export(plan, rotationFor, signal, onProgress) {
      const zipClass = plan.zipped ? (root.JSZip || await loadScript('https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js', 'JSZip')) : null;
      const zip = zipClass ? new zipClass() : null;
      let single = null; let done = 0;
      const entries = plan.entries;
      for (const entry of entries) {
        abortCheck(signal);
        let data;
        if (entry.type === 'pdf') data = await this.pdfBytes(entry.pages, rotationFor, signal);
        else {
          const n = entry.pages[0];
          const canvas = await this.render(n, rotationFor(n), { signal });
          try {
            data = await new Promise((resolve, reject) => canvas.toBlob(blob => {
              if (blob) resolve(blob); else reject(new Error('画像の生成に失敗しました。ページ数を減らしてお試しください。'));
            }, entry.type === 'jpg' ? 'image/jpeg' : 'image/png', entry.type === 'jpg' ? 0.92 : undefined));
          } finally { canvas.width = canvas.height = 1; }
        }
        abortCheck(signal);
        const blob = data instanceof Blob ? data : new Blob([data], { type: 'application/pdf' });
        if (zip) zip.file(entry.name, blob); else single = { blob, name: entry.name };
        done++;
        onProgress?.(Math.round(done / entries.length * (zip ? 80 : 100)), `${done} / ${entries.length} ファイルを生成しました`);
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      if (zip) {
        const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE', streamFiles: true }, metadata => {
          abortCheck(signal); onProgress?.(80 + Math.round(metadata.percent * .2), 'ZIPにまとめています…');
        });
        abortCheck(signal); return { blob, name: plan.zipName };
      }
      return single;
    }
  }
  root.PDFClipEngine = Object.freeze({ open, PdfSession });
})(globalThis);
