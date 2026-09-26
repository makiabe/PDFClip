/* Pure PDF Clip selection/export helpers. No DOM, storage, or networking. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PDFClipCore = api;
})(globalThis, function () {
  'use strict';
  const normalizeRotation = n => ((Number(n) % 360) + 360) % 360;
  function parseRange(value, total) {
    if (!Number.isInteger(total) || total < 1) throw new Error('先にPDFを選択してください。');
    const normalized = String(value).normalize('NFKC').replace(/[、，]/g, ',')
      .replace(/[‐‑‒–—−ー〜~]/g, '-').trim().replace(/\s*-\s*/g, '-');
    if (!normalized) throw new Error('ページ番号を入力してください。例：1-3, 5');
    const tokens = normalized.split(/\s*,\s*|\s+/);
    const result = new Set();
    for (const token of tokens) {
      if (!/^\d+(?:-\d+)?$/.test(token)) throw new Error('ページ指定を確認してください。例：1-3, 5');
      const [a, end] = token.split('-').map(Number);
      const b = end ?? a;
      if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || a < 1 || b < 1 || a > total || b > total)
        throw new Error(`1〜${total}の範囲で指定してください。`);
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++) result.add(i);
    }
    return result;
  }
  function complement(selected, total) {
    const out = new Set();
    for (let i = 1; i <= total; i++) if (!selected.has(i)) out.add(i);
    return out;
  }
  function outputPages(selected, total, deleting) {
    return [...(deleting ? complement(selected, total) : selected)]
      .filter(n => Number.isInteger(n) && n > 0 && n <= total).sort((a, b) => a - b);
  }
  function formatRanges(numbers) {
    const a = [...new Set(numbers)].sort((x, y) => x - y);
    const result = [];
    for (let i = 0; i < a.length; i++) {
      const start = a[i]; let end = start;
      while (i + 1 < a.length && a[i + 1] === end + 1) end = a[++i];
      result.push(start === end ? `${start}` : `${start}-${end}`);
    }
    return result.join(', ');
  }
  function safeBase(name) {
    let base = String(name).normalize('NFC').replace(/\.pdf$/i, '')
      .replace(/[\\/<>:"|?*\u0000-\u001f\u007f]/g, '_').replace(/^[. ]+|[. ]+$/g, '');
    base = [...base].slice(0, 100).join('');
    if (!base || /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(base)) base = 'document';
    return base;
  }
  function planExports({ name, pages, total, formats, pdfMode, deleting = false }) {
    if (!pages.length) throw new Error(deleting ? 'すべてのページは削除できません。残すページを1ページ以上指定してください。' : '保存するページを選択してください。');
    const types = [...new Set(formats)].filter(x => ['pdf', 'jpg', 'png'].includes(x));
    if (!types.length) throw new Error('出力形式を1つ以上選択してください。');
    const base = safeBase(name), digits = Math.max(2, String(total).length);
    const entries = [], folder = type => types.length > 1 ? type + '/' : '';
    for (const type of types) {
      if (type === 'pdf' && pdfMode !== 'split') {
        entries.push({ type, pages: [...pages], name: `${folder(type)}${base}_${deleting ? 'edited' : 'clip'}.pdf` });
      } else {
        for (const page of pages) entries.push({ type, pages: [page], name: `${folder(type)}${base}_page_${String(page).padStart(digits, '0')}.${type}` });
      }
    }
    return { entries, zipName: `${base}_export.zip`, zipped: entries.length > 1 };
  }
  return Object.freeze({ normalizeRotation, parseRange, complement, outputPages, formatRanges, safeBase, planExports });
});
