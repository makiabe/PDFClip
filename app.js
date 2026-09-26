/* PDF Clip UI. Help, navigation and layout do not depend on a CDN. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const C = globalThis.PDFClipCore;
  const state = {
    session: null, selected: new Set(), rotations: new Map(), busy: false,
    pageStart: 0, pageSize: 24, thumbController: null, previewController: null,
    exportController: null, loadController: null, downloadUrl: null
  };
  function message(id, text = '', kind = '') {
    const node = $(id);
    node.textContent = text; node.hidden = !text;
    node.classList.toggle('error', kind === 'error'); node.classList.toggle('success', kind === 'success');
  }
  function formats() { return [...document.querySelectorAll('input[name=format]:checked')].map(el => el.value); }
  function settings() {
    return {
      formats: formats(),
      pdfMode: document.querySelector('input[name=pdfMode]:checked').value,
      deleting: $('deleteMode').checked,
      rotation: $('rotateEnabled').checked ? Number($('rotationSelect').value) : 0
    };
  }
  function getPages(s = settings()) { return state.session ? C.outputPages(state.selected, state.session.total, s.deleting) : []; }
  function rotationSnapshot(s = settings()) {
    const selectedOutput = new Set(getPages(s)), rotations = new Map(state.rotations);
    return n => C.normalizeRotation((rotations.get(n) || 0) + (selectedOutput.has(n) ? s.rotation : 0));
  }
  function clearDownload() {
    $('downloadAgain').hidden = true; $('downloadAgain').removeAttribute('href');
    if (state.downloadUrl) URL.revokeObjectURL(state.downloadUrl);
    state.downloadUrl = null;
  }
  function changed() { clearDownload(); message('exportStatus'); }
  function controls() {
    $('exportSummary').hidden = !state.session;
    document.body.classList.toggle('has-pdf', !!state.session);
    const s = settings(), pages = getPages(s);
    $('generateLabel').textContent = s.formats.length === 1 ? (s.formats[0] === 'pdf' ? 'PDFを生成' : '画像を生成') : 'ファイルを生成';
    $('generateButton').disabled = state.busy || !s.formats.length || Boolean(state.session && !pages.length);
    $('generateButton').setAttribute('aria-busy', String(state.busy));
    $('dropZone').disabled = state.busy; $('fileInput').disabled = state.busy;
    document.querySelectorAll('#optionGrid fieldset').forEach(el => { el.disabled = state.busy; });
    $('countOptions').disabled = state.busy || !s.formats.includes('pdf');
    $('countNote').hidden = s.formats.includes('pdf');
    $('rotationSelect').disabled = state.busy || !$('rotateEnabled').checked;
    document.querySelectorAll('#workspace button,#workspace input').forEach(el => { el.disabled = state.busy; });
    $('workspace').classList.toggle('is-delete', s.deleting);
    $('selectionHint').textContent = s.deleting
      ? '削除モード：赤いチェックのページを除外します。残したいページにはチェックを付けないでください。'
      : '保存したいページにチェックを付けてください。選んだページを元の順番で保存します。';
    if (!state.session) {
      $('exportSummary').textContent = 'PDFを選択してから、保存したいページを選んでください。';
      return;
    }
    $('selectionCount').textContent = `${s.deleting ? '削除対象' : '選択中'}：${state.selected.size} / ${state.session.total} ページ`;
    $('outputCount').textContent = `保存：${pages.length} ページ`;
    $('previousPages').disabled = state.busy || state.pageStart === 0;
    $('nextPages').disabled = state.busy || state.pageStart + state.pageSize >= state.session.total;
    $('pagination').hidden = state.session.total <= state.pageSize;
    $('pageWindowLabel').textContent = `${state.pageStart + 1}–${Math.min(state.pageStart + state.pageSize, state.session.total)} / ${state.session.total}`;
    if (!s.formats.length) $('exportSummary').textContent = '出力形式を1つ以上選択してください。';
    else if (!pages.length) $('exportSummary').textContent = s.deleting ? 'すべてのページは削除できません。1ページ以上残してください。' : '保存したいページを選択してください。';
    else {
      const plan = C.planExports({ name: state.session.name, pages, total: state.session.total, ...s });
      const typeNames = s.formats.map(x => x.toUpperCase()).join('・');
      $('exportSummary').textContent = `${pages.length}ページ → ${typeNames} ${plan.entries.length}ファイル${plan.zipped ? '（ZIPで保存）' : ''}`;
    }
    const rotationFor = rotationSnapshot(s);
    $('pageGrid').querySelectorAll('.page-card').forEach(card => {
      const n = Number(card.dataset.page), selected = state.selected.has(n), checkbox = card.querySelector('.page-checkbox');
      card.classList.toggle('is-selected', selected); checkbox.checked = selected;
      checkbox.setAttribute('aria-label', `${n}ページを${s.deleting ? '削除対象' : '保存対象'}にする`);
      const delta = rotationFor(n), included = s.deleting ? !selected : selected;
      card.querySelector('.page-state').textContent = `${included ? '保存する' : s.deleting ? '削除する' : '保存しない'}${delta ? ` · ＋${delta}°` : ''}`;
    });
  }
  function setBusy(busy) { state.busy = busy; controls(); }
  function cancelThumbnails() { state.thumbController?.abort(); state.thumbController = null; }
  function releaseCanvases(node) { node.querySelectorAll('canvas').forEach(canvas => { canvas.width = canvas.height = 1; }); }
  function drawThumbnails() {
    cancelThumbnails();
    if (!state.session || state.busy) return;
    const controller = new AbortController(); state.thumbController = controller;
    const session = state.session, cards = [...$('pageGrid').children], rotationFor = rotationSnapshot();
    let cursor = 0;
    async function worker() {
      while (cursor < cards.length && !controller.signal.aborted) {
        const card = cards[cursor++], n = Number(card.dataset.page), wrapper = card.querySelector('.thumb-wrap');
        try {
          const canvas = await session.render(n, rotationFor(n), { signal: controller.signal, scale: 2, maxWidth: 340, maxHeight: 440, maxPixels: 200000 });
          if (controller.signal.aborted || !card.isConnected || session !== state.session) { canvas.width = canvas.height = 1; return; }
          canvas.setAttribute('aria-hidden', 'true');
          releaseCanvases(wrapper); wrapper.replaceChildren(canvas);
        } catch (error) {
          if (controller.signal.aborted || error.name === 'AbortError' || error.name === 'RenderingCancelledException') return;
          releaseCanvases(wrapper);
          const label = document.createElement('span'); label.className = 'thumb-status'; label.textContent = 'プレビューを表示できません';
          wrapper.replaceChildren(label);
        }
      }
    }
    void Promise.all([worker(), worker()]);
  }
  function buildGrid() {
    cancelThumbnails(); releaseCanvases($('pageGrid')); $('pageGrid').replaceChildren();
    if (!state.session) return;
    const fragment = document.createDocumentFragment(), end = Math.min(state.pageStart + state.pageSize, state.session.total);
    for (let n = state.pageStart + 1; n <= end; n++) {
      const card = $('pageTemplate').content.firstElementChild.cloneNode(true); card.dataset.page = String(n);
      card.querySelector('.page-number').textContent = `P. ${n}`;
      card.querySelector('.page-checkbox').addEventListener('change', event => {
        if (state.busy) return;
        if (event.target.checked) state.selected.add(n); else state.selected.delete(n);
        changed(); controls();
        if ($('rotateEnabled').checked) drawThumbnails();
      });
      card.querySelectorAll('[data-page-action]').forEach(button => {
        const action = button.dataset.pageAction;
        const description = action === 'preview' ? '拡大する' : action === 'left' ? '左90度回転する' : '右90度回転する';
        button.setAttribute('aria-label', `${n}ページを${description}`); button.title = description;
        button.addEventListener('click', () => {
          if (state.busy) return;
          if (action === 'preview') { void preview(n); return; }
          state.rotations.set(n, C.normalizeRotation((state.rotations.get(n) || 0) + (action === 'left' ? -90 : 90)));
          changed(); controls(); drawThumbnails();
        });
      });
      fragment.append(card);
    }
    $('pageGrid').append(fragment); controls(); drawThumbnails();
  }
  async function loadFile(file) {
    if (!file || state.busy) return;
    changed(); cancelThumbnails();
    state.loadController = new AbortController();
    setBusy(true); message('loadStatus', 'PDFを読み込んでいます…');
    try {
      const nextSession = await globalThis.PDFClipEngine.open(file, state.loadController.signal);
      const previous = state.session;
      state.session = nextSession; state.pageStart = 0; state.rotations.clear();
      state.selected = $('deleteMode').checked ? new Set() : new Set(Array.from({ length: nextSession.total }, (_, i) => i + 1));
      $('rangeInput').value = ''; message('rangeError');
      $('fileName').textContent = nextSession.name; $('fileName').title = nextSession.name;
      $('fileSize').textContent = nextSession.size >= 1024 * 1024 ? (nextSession.size / 1024 / 1024).toFixed(1) + ' MB' : Math.ceil(nextSession.size / 1024) + ' KB';
      $('emptyFile').hidden = true; $('loadedFile').hidden = false; $('workspace').hidden = false;
      message('loadStatus', `${nextSession.total}ページのPDFを開きました。`, 'success');
      if (previous) await previous.dispose();
    } catch (error) {
      if (error.name !== 'AbortError') message('loadStatus', error.message || 'PDFを読み込めませんでした。', 'error');
    } finally {
      state.loadController = null; $('fileInput').value = ''; setBusy(false); buildGrid();
    }
  }
  async function closeFile() {
    if (state.busy) return;
    cancelThumbnails(); state.previewController?.abort();
    clearDownload(); releaseCanvases($('pageGrid')); $('pageGrid').replaceChildren();
    const previous = state.session; state.session = null; state.selected.clear(); state.rotations.clear(); state.pageStart = 0;
    $('fileInput').value = ''; $('fileName').textContent = ''; $('fileName').removeAttribute('title'); $('fileSize').textContent = '';
    $('emptyFile').hidden = false; $('loadedFile').hidden = true; $('workspace').hidden = true;
    $('rotateEnabled').checked = false; $('deleteMode').checked = false;
    message('loadStatus'); message('exportStatus'); message('rangeError'); controls();
    $('dropZone').focus(); if (previous) await previous.dispose();
  }
  $('dropZone').addEventListener('click', () => { if (!state.busy) $('fileInput').click(); });
  $('fileInput').addEventListener('change', () => { void loadFile($('fileInput').files[0]); });
  $('clearFile').addEventListener('click', () => { void closeFile(); });
  ['dragenter', 'dragover'].forEach(type => $('dropZone').addEventListener(type, event => { event.preventDefault(); if (!state.busy) $('dropZone').classList.add('is-dragging'); }));
  $('dropZone').addEventListener('dragleave', event => { if (!$('dropZone').contains(event.relatedTarget)) $('dropZone').classList.remove('is-dragging'); });
  $('dropZone').addEventListener('drop', event => {
    event.preventDefault(); $('dropZone').classList.remove('is-dragging');
    if (state.busy) return;
    const files = [...event.dataTransfer.files];
    if (files.length !== 1) { message('loadStatus', 'PDFファイルを1つずつ選択してください。', 'error'); return; }
    void loadFile(files[0]);
  });
  ['dragover', 'drop'].forEach(type => document.addEventListener(type, event => { if (event.dataTransfer?.types.includes('Files')) event.preventDefault(); }));
  document.querySelectorAll('[data-select]').forEach(button => button.addEventListener('click', () => {
    if (!state.session || state.busy) return;
    const action = button.dataset.select, total = state.session.total;
    if (action === 'invert') state.selected = C.complement(state.selected, total);
    else state.selected = new Set(Array.from({ length: total }, (_, i) => i + 1).filter(n => action === 'all' || (action === 'odd' && n % 2) || (action === 'even' && n % 2 === 0)));
    changed(); message('rangeError'); controls(); if ($('rotateEnabled').checked) drawThumbnails();
  }));
  function applyRange() {
    if (!state.session || state.busy) return;
    try { state.selected = C.parseRange($('rangeInput').value, state.session.total); changed(); message('rangeError'); $('rangeInput').removeAttribute('aria-invalid'); controls(); if ($('rotateEnabled').checked) drawThumbnails(); }
    catch (error) { message('rangeError', error.message, 'error'); $('rangeInput').setAttribute('aria-invalid', 'true'); }
  }
  $('rangeButton').addEventListener('click', applyRange);
  $('rangeInput').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); applyRange(); } });
  $('previousPages').addEventListener('click', () => { if (!state.busy) { state.pageStart = Math.max(0, state.pageStart - state.pageSize); buildGrid(); } });
  $('nextPages').addEventListener('click', () => { if (!state.busy && state.pageStart + state.pageSize < state.session.total) { state.pageStart += state.pageSize; buildGrid(); } });
  document.querySelectorAll('input[name=format],input[name=pdfMode]').forEach(input => input.addEventListener('change', () => { changed(); controls(); }));
  $('deleteMode').addEventListener('change', () => {
    if (state.session) state.selected = C.complement(state.selected, state.session.total); // Keep output pages unchanged when switching modes.
    changed(); controls(); drawThumbnails();
  });
  ['rotateEnabled', 'rotationSelect'].forEach(id => $(id).addEventListener('change', () => { changed(); controls(); drawThumbnails(); }));
  $('generateButton').addEventListener('click', async () => {
    if (state.busy) return;
    if (!state.session) { message('exportStatus', '先にPDFファイルを選択してください。', 'error'); $('dropZone').focus(); return; }
    const s = settings(), session = state.session, pages = getPages(s), rotationFor = rotationSnapshot(s);
    let plan;
    try { plan = C.planExports({ name: session.name, pages, total: session.total, ...s }); }
    catch (error) { message('exportStatus', error.message, 'error'); return; }
    clearDownload(); cancelThumbnails(); setBusy(true);
    const controller = new AbortController(); state.exportController = controller;
    $('progressArea').hidden = false; $('exportProgress').value = 0; $('cancelExport').disabled = false;
    message('exportStatus', 'ファイルを生成しています…');
    try {
      const result = await session.export(plan, rotationFor, controller.signal, (percent, text) => { $('exportProgress').value = percent; message('exportStatus', text); });
      if (controller.signal.aborted) throw new DOMException('処理を中止しました。', 'AbortError');
      state.downloadUrl = URL.createObjectURL(result.blob);
      const link = $('downloadAgain'); link.href = state.downloadUrl; link.download = result.name; link.hidden = false;
      link.click();
      message('exportStatus', `${plan.entries.length}ファイルを生成しました。保存が始まらない場合は下のリンクを押してください。`, 'success');
    } catch (error) {
      message('exportStatus', error.name === 'AbortError' ? '処理を中止しました。設定を変更して、もう一度生成できます。' : 'ファイルの生成に失敗しました。ページ数を減らすか、別のPDFでお試しください。', error.name === 'AbortError' ? '' : 'error');
    } finally {
      state.exportController = null; $('progressArea').hidden = true; setBusy(false); drawThumbnails();
    }
  });
  $('cancelExport').addEventListener('click', () => { state.exportController?.abort(); $('cancelExport').disabled = true; message('exportStatus', '現在のページの処理が終わり次第、中止します…'); });

  // Help and theme remain usable even when the PDF libraries cannot be loaded.
  const help = {
    about: ['PDF Clipについて', '<p>PDFから必要なページだけを選んで、別のPDFとして保存できる無料ツールです。</p><ol><li>PDFファイルを選択します。</li><li>保存するページと出力形式を選びます。</li><li>生成ボタンを押すとダウンロードできます。</li></ol><p>PDFの分割・回転・不要ページの削除・JPG/PNG画像への変換に対応しています。PDFファイルは外部サーバーに送信しません。</p>'],
    formats: ['出力形式について', '<p><b>PDF</b>は、選択したページを新しいPDFとして保存します。</p><p><b>JPG・PNG</b>は、1ページごとに画像を生成します。複数の形式を同時に選ぶこともできます。</p><p>生成するファイルが1つなら直接保存、2つ以上ならZIPにまとめます。複数形式の場合は、ZIP内の形式別フォルダーに分かれます。</p>'],
    count: ['生成件数について', '<p><b>1件</b>：選んだページを元の順番で、1つのPDFにまとめます。</p><p><b>複数</b>：1ページごとに個別のPDFを生成します。複数ファイルはZIPで保存します。</p><p>この設定はPDFの出力に適用されます。JPG・PNGは常に1ページずつ画像化します。</p>'],
    operations: ['ページ操作について', '<p><b>回転</b>：チェックすると、保存対象の全ページに指定した角度の回転を追加します。各ページの回転ボタンと組み合わせることもできます。</p><p><b>削除</b>：チェックすると、赤いチェックのページを除外し、残りを保存します。切り替え時は保存対象が変わらないよう選択状態が反転します。</p><p>元のPDFファイルは変更しません。回転後の向きはプレビューと、すべての出力形式に反映されます。</p>']
  };
  function openDialog(dialog) { if (!dialog.open) { dialog.showModal(); document.body.classList.add('modal-open'); } }
  document.querySelectorAll('[data-help]').forEach(button => button.addEventListener('click', () => {
    const [title, content] = help[button.dataset.help]; $('helpTitle').textContent = title; $('helpBody').innerHTML = content; openDialog($('helpDialog'));
  }));
  document.querySelectorAll('[data-open]').forEach(link => link.addEventListener('click', event => {
    event.preventDefault(); openDialog($(link.dataset.open));
  }));
  document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => $(button.dataset.close).close()));
  ['helpDialog', 'previewDialog', 'howto', 'faq'].forEach(id => {
    const dialog = $(id);
    dialog.addEventListener('click', event => {
      const rect = dialog.getBoundingClientRect();
      if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) dialog.close();
    });
    dialog.addEventListener('close', () => {
      if (id === 'previewDialog') { state.previewController?.abort(); releaseCanvases($('previewBody')); $('previewBody').replaceChildren(); }
      if (!document.querySelector('dialog[open]')) document.body.classList.remove('modal-open');
    });
  });
  async function preview(n) {
    if (!state.session) return;
    state.previewController?.abort();
    const controller = new AbortController(); state.previewController = controller;
    releaseCanvases($('previewBody')); $('previewBody').textContent = 'プレビューを読み込んでいます…';
    $('previewTitle').textContent = `${n}ページのプレビュー`;
    openDialog($('previewDialog'));
    try {
      const canvas = await state.session.render(n, rotationSnapshot()(n), { signal: controller.signal, scale: 2, maxWidth: Math.min(innerWidth - 64, 800) * 2, maxHeight: Math.max(200, innerHeight - 160) * 2, maxPixels: 4000000 });
      if (controller.signal.aborted) { canvas.width = canvas.height = 1; return; }
      $('previewBody').replaceChildren(canvas);
    } catch (error) { if (!controller.signal.aborted) $('previewBody').textContent = 'このページのプレビューを表示できませんでした。'; }
  }
  function setTheme(theme) {
    document.documentElement.dataset.theme = theme;
    $('themeButton').setAttribute('aria-pressed', String(theme === 'dark'));
    $('themeButton').setAttribute('aria-label', theme === 'dark' ? 'ライトモードに切り替え' : 'ダークモードに切り替え');
    document.querySelector('meta[name=theme-color]').content = theme === 'dark' ? '#171622' : '#f4f8ff';
  }
  try { setTheme(localStorage.getItem('pdfclip-theme') === 'dark' ? 'dark' : 'light'); } catch { setTheme('light'); }
  $('themeButton').addEventListener('click', () => {
    const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; setTheme(theme);
    try { localStorage.setItem('pdfclip-theme', theme); } catch { /* No PDF data is stored. */ }
  });
  document.querySelectorAll('.top-nav a').forEach(link => link.addEventListener('click', () => {
    document.querySelectorAll('.top-nav a').forEach(a => a.classList.toggle('is-active', a === link));
  }));
  window.addEventListener('pagehide', () => {
    state.loadController?.abort(); state.exportController?.abort(); state.previewController?.abort(); cancelThumbnails(); clearDownload();
  });
  window.addEventListener('pageshow', event => {
    if (event.persisted) { controls(); drawThumbnails(); }
  });
  controls();
})();
