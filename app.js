import * as pdfjsLib from "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs";
pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";

const { PDFDocument } = window.PDFLib;

const fileInput = document.querySelector("#fileInput");
const chooseButton = document.querySelector("#chooseButton");
const dropZone = document.querySelector("#dropZone");
const workspace = document.querySelector("#workspace");
const fileNameEl = document.querySelector("#fileName");
const pageCountEl = document.querySelector("#pageCount");
const selectedCountEl = document.querySelector("#selectedCount");
const pageGrid = document.querySelector("#pageGrid");
const rangeInput = document.querySelector("#rangeInput");
const rangeButton = document.querySelector("#rangeButton");
const downloadButton = document.querySelector("#downloadButton");
const downloadLabel = document.querySelector("#downloadLabel");
const splitButton = document.querySelector("#splitButton");
const deleteButton = document.querySelector("#deleteButton");
const rotateLeftButton = document.querySelector("#rotateLeftButton");
const rotateRightButton = document.querySelector("#rotateRightButton");
const jpgButton = document.querySelector("#jpgButton");
const pngButton = document.querySelector("#pngButton");
const previewDialog = document.querySelector("#previewDialog");
const previewCanvas = document.querySelector("#previewCanvas");
const previewCaption = document.querySelector("#previewCaption");
const closePreview = document.querySelector("#closePreview");

let sourceFile = null;
let sourceBytes = null;
let pdf = null;
let selectedPages = new Set();
const rotations = new Map();

chooseButton.addEventListener("click", () => fileInput.click());
dropZone.addEventListener("click", (e) => {
  if (e.target !== chooseButton) fileInput.click();
});
fileInput.addEventListener("change", () => {
  const [file] = fileInput.files;
  if (file) loadPdf(file);
});

["dragenter","dragover"].forEach(type => dropZone.addEventListener(type, e => {
  e.preventDefault();
  dropZone.classList.add("dragover");
}));
["dragleave","drop"].forEach(type => dropZone.addEventListener(type, e => {
  e.preventDefault();
  dropZone.classList.remove("dragover");
}));
dropZone.addEventListener("drop", e => {
  const file = [...e.dataTransfer.files].find(f => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
  if (file) loadPdf(file);
});

document.querySelectorAll("[data-action]").forEach(button => {
  button.addEventListener("click", () => applyQuickSelect(button.dataset.action));
});
rangeButton.addEventListener("click", applyRange);
rangeInput.addEventListener("keydown", e => { if (e.key === "Enter") applyRange(); });
downloadButton.addEventListener("click", downloadSelection);
splitButton.addEventListener("click", downloadPagesSeparately);
deleteButton.addEventListener("click", deleteSelectedPages);
rotateLeftButton.addEventListener("click", () => rotateSelected(-90));
rotateRightButton.addEventListener("click", () => rotateSelected(90));
jpgButton.addEventListener("click", () => exportImages("jpeg"));
pngButton.addEventListener("click", () => exportImages("png"));
closePreview.addEventListener("click", () => previewDialog.close());
previewDialog.addEventListener("click", e => {
  if (e.target === previewDialog) previewDialog.close();
});

async function loadPdf(file) {
  try {
    sourceFile = file;
    sourceBytes = new Uint8Array(await file.arrayBuffer());
    pdf = await pdfjsLib.getDocument({ data: sourceBytes.slice() }).promise;

    selectedPages = new Set();
    rotations.clear();
    fileNameEl.textContent = file.name;
    pageCountEl.textContent = pdf.numPages;
    pageGrid.innerHTML = "";
    workspace.classList.remove("hidden");
    dropZone.classList.add("hidden");
    updateSelectionUI();

    for (let n = 1; n <= pdf.numPages; n++) {
      const card = document.createElement("article");
      card.className = "page-card";
      card.dataset.page = n;
      card.innerHTML = `
        <div class="page-top">
          <span class="page-number">P.${n}</span>
          <div class="page-actions">
            <button class="preview-btn" title="拡大プレビュー" aria-label="${n}ページを拡大">⌕</button>
            <span class="check"></span>
          </div>
        </div>
        <div class="thumb-wrap"><canvas></canvas></div>`;

      card.addEventListener("click", e => {
        if (e.target.closest(".preview-btn")) return;
        togglePage(n);
      });
      card.querySelector(".preview-btn").addEventListener("click", e => {
        e.stopPropagation();
        showPreview(n);
      });
      pageGrid.appendChild(card);
      renderThumb(n, card.querySelector("canvas"));
    }
  } catch (err) {
    console.error(err);
    alert("PDFを読み込めませんでした。暗号化・破損したPDFでないか確認してください。");
  }
}

async function renderThumb(pageNumber, canvas) {
  const page = await pdf.getPage(pageNumber);
  const extraRotation = rotations.get(pageNumber) || 0;
  const raw = page.getViewport({ scale: 1, rotation: normalizeRotation(page.rotate + extraRotation) });
  const targetWidth = 150;
  const viewport = page.getViewport({ scale: targetWidth / raw.width, rotation: normalizeRotation(page.rotate + extraRotation) });
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(viewport.width * dpr);
  canvas.height = Math.floor(viewport.height * dpr);
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;
  await page.render({
    canvasContext: canvas.getContext("2d"),
    viewport,
    transform: dpr !== 1 ? [dpr,0,0,dpr,0,0] : null
  }).promise;
}

function togglePage(n) {
  selectedPages.has(n) ? selectedPages.delete(n) : selectedPages.add(n);
  updateSelectionUI();
}

function applyQuickSelect(action) {
  if (!pdf) return;
  if (action === "none") selectedPages.clear();
  else if (action === "invert") {
    const next = new Set();
    for (let i=1;i<=pdf.numPages;i++) if (!selectedPages.has(i)) next.add(i);
    selectedPages = next;
  } else {
    selectedPages.clear();
    for (let i=1;i<=pdf.numPages;i++) {
      if (action === "all" || (action === "odd" && i%2===1) || (action === "even" && i%2===0)) selectedPages.add(i);
    }
  }
  updateSelectionUI();
}

function applyRange() {
  if (!pdf) return;
  const parsed = parseRange(rangeInput.value, pdf.numPages);
  if (!parsed) {
    alert("ページ指定を確認してください。例: 1-3, 5, 8-10");
    return;
  }
  selectedPages = new Set(parsed);
  updateSelectionUI();
}

function parseRange(value, max) {
  const text = value.replace(/\s+/g, "");
  if (!text) return [];
  const result = new Set();
  for (const token of text.split(",")) {
    if (/^\d+$/.test(token)) {
      const n = Number(token);
      if (n < 1 || n > max) return null;
      result.add(n);
      continue;
    }
    const m = token.match(/^(\d+)-(\d+)$/);
    if (!m) return null;
    let a = Number(m[1]), b = Number(m[2]);
    if (a < 1 || b < 1 || a > max || b > max) return null;
    if (a > b) [a,b] = [b,a];
    for (let i=a;i<=b;i++) result.add(i);
  }
  return [...result].sort((a,b)=>a-b);
}

function updateSelectionUI() {
  selectedCountEl.textContent = selectedPages.size;
  document.querySelectorAll(".page-card").forEach(card => {
    const n = Number(card.dataset.page);
    const selected = selectedPages.has(n);
    card.classList.toggle("selected", selected);
    card.querySelector(".check").textContent = selected ? "✓" : "";
  });
  downloadButton.disabled = selectedPages.size === 0;
  splitButton.disabled = selectedPages.size === 0;
  deleteButton.disabled = selectedPages.size === 0 || selectedPages.size === pdf?.numPages;
  rotateLeftButton.disabled = selectedPages.size === 0;
  rotateRightButton.disabled = selectedPages.size === 0;
  jpgButton.disabled = selectedPages.size === 0;
  pngButton.disabled = selectedPages.size === 0;
  downloadLabel.textContent = selectedPages.size
    ? `${selectedPages.size}ページを抽出してダウンロード`
    : "ページを選択してください";
}

async function showPreview(n) {
  const page = await pdf.getPage(n);
  const extraRotation = rotations.get(n) || 0;
  const raw = page.getViewport({ scale: 1, rotation: normalizeRotation(page.rotate + extraRotation) });
  const maxWidth = Math.min(window.innerWidth * .82, 900);
  const maxHeight = window.innerHeight * .75;
  const scale = Math.min(maxWidth/raw.width, maxHeight/raw.height);
  const viewport = page.getViewport({ scale, rotation: normalizeRotation(page.rotate + extraRotation) });
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  previewCanvas.width = Math.floor(viewport.width*dpr);
  previewCanvas.height = Math.floor(viewport.height*dpr);
  previewCanvas.style.width = `${viewport.width}px`;
  previewCanvas.style.height = `${viewport.height}px`;
  await page.render({
    canvasContext: previewCanvas.getContext("2d"),
    viewport,
    transform: dpr !== 1 ? [dpr,0,0,dpr,0,0] : null
  }).promise;
  previewCaption.textContent = `P.${n}`;
  previewDialog.showModal();
}

async function downloadSelection() {
  if (!sourceBytes || !selectedPages.size) return;
  try {
    downloadButton.disabled = true;
    downloadLabel.textContent = "PDFを作成中…";
    const src = await PDFDocument.load(sourceBytes);
    const out = await PDFDocument.create();
    const indices = [...selectedPages].sort((a,b)=>a-b).map(n => n - 1);
    const copied = await out.copyPages(src, indices);
    copied.forEach((page,i) => {
      const n = [...selectedPages].sort((a,b)=>a-b)[i];
      const angle = rotations.get(n) || 0;
      if (angle) page.setRotation(PDFLib.degrees(normalizeRotation(page.getRotation().angle + angle)));
      out.addPage(page);
    });
    const result = await out.save();
    const blob = new Blob([result], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const base = sourceFile.name.replace(/\.pdf$/i, "");
    a.href = url;
    a.download = `${base}_clip_${selectedPages.size}pages.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  } catch (err) {
    console.error(err);
    alert("PDFの抽出に失敗しました。");
  } finally {
    downloadButton.disabled = selectedPages.size === 0;
    downloadLabel.textContent = selectedPages.size
      ? `${selectedPages.size}ページを抽出してダウンロード`
      : "ページを選択してください";
  }
}
const helpButton = document.querySelector("#helpButton");
const helpDialog = document.querySelector("#helpDialog");
const closeHelp = document.querySelector("#closeHelp");
function openHelp() {
  helpDialog.classList.remove("hidden");
  document.body.style.overflow = "hidden";
}
function closeHelpDialog() {
  helpDialog.classList.add("hidden");
  document.body.style.overflow = "";
}
helpButton.addEventListener("click", openHelp);
closeHelp.addEventListener("click", closeHelpDialog);
helpDialog.addEventListener("click", e => {
  if (e.target === helpDialog) closeHelpDialog();
});
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && !helpDialog.classList.contains("hidden")) closeHelpDialog();
});

async function downloadPagesSeparately() {
  if (!sourceBytes || !selectedPages.size) return;
  try {
    splitButton.disabled = true;
    splitButton.textContent = "分割PDFを作成中…";
    const src = await PDFDocument.load(sourceBytes);
    const zip = new JSZip();
    const base = sourceFile.name.replace(/\.pdf$/i, "");
    const pages = [...selectedPages].sort((a,b)=>a-b);
    const digits = String(src.getPageCount()).length;

    for (const pageNumber of pages) {
      const out = await PDFDocument.create();
      const [copied] = await out.copyPages(src, [pageNumber - 1]);
      out.addPage(copied);
      const bytes = await out.save();
      zip.file(`${base}_page_${String(pageNumber).padStart(digits,"0")}.pdf`, bytes);
    }

    const blob = await zip.generateAsync({type:"blob"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${base}_split_${pages.length}pages.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  } catch (err) {
    console.error(err);
    alert("1ページずつのPDF分割に失敗しました。");
  } finally {
    splitButton.disabled = selectedPages.size === 0;
    splitButton.textContent = "選択ページを1ページずつ保存";
  }
}

function normalizeRotation(value) {
  return ((value % 360) + 360) % 360;
}

async function rotateSelected(delta) {
  if (!pdf || !selectedPages.size) return;
  for (const n of selectedPages) {
    rotations.set(n, normalizeRotation((rotations.get(n) || 0) + delta));
    const card = document.querySelector(`.page-card[data-page="${n}"]`);
    const canvas = card?.querySelector("canvas");
    if (canvas) await renderThumb(n, canvas);
  }
}

async function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

async function deleteSelectedPages() {
  if (!sourceBytes || !selectedPages.size || selectedPages.size >= pdf.numPages) return;
  try {
    deleteButton.disabled = true;
    deleteButton.textContent = "PDFを作成中…";
    const src = await PDFDocument.load(sourceBytes);
    const out = await PDFDocument.create();
    const keep = [];
    for (let n=1; n<=src.getPageCount(); n++) if (!selectedPages.has(n)) keep.push(n);
    const copied = await out.copyPages(src, keep.map(n=>n-1));
    copied.forEach((page,i) => {
      const angle = rotations.get(keep[i]) || 0;
      if (angle) page.setRotation(PDFLib.degrees(normalizeRotation(page.getRotation().angle + angle)));
      out.addPage(page);
    });
    const bytes = await out.save();
    await saveBlob(new Blob([bytes],{type:"application/pdf"}), `${sourceFile.name.replace(/\.pdf$/i,"")}_deleted.pdf`);
  } catch(e) {
    console.error(e); alert("ページ削除後のPDF生成に失敗しました。");
  } finally {
    deleteButton.textContent = "選択ページを削除して保存";
    updateSelectionUI();
  }
}

async function exportImages(format) {
  if (!pdf || !selectedPages.size) return;
  const button = format === "jpeg" ? jpgButton : pngButton;
  const ext = format === "jpeg" ? "jpg" : "png";
  try {
    button.disabled = true;
    button.textContent = "画像を作成中…";
    const pages = [...selectedPages].sort((a,b)=>a-b);
    const zip = new JSZip();
    const base = sourceFile.name.replace(/\.pdf$/i,"");
    const digits = String(pdf.numPages).length;
    let singleBlob = null, singleName = "";

    for (const n of pages) {
      const page = await pdf.getPage(n);
      const extra = rotations.get(n) || 0;
      const viewport = page.getViewport({scale:2, rotation: normalizeRotation(page.rotate + extra)});
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext("2d");
      if (format === "jpeg") { ctx.fillStyle="#fff"; ctx.fillRect(0,0,canvas.width,canvas.height); }
      await page.render({canvasContext:ctx,viewport}).promise;
      const blob = await new Promise(resolve => canvas.toBlob(resolve, `image/${format}`, format==="jpeg" ? .92 : undefined));
      const name = `${base}_page_${String(n).padStart(digits,"0")}.${ext}`;
      if (pages.length === 1) { singleBlob=blob; singleName=name; }
      else zip.file(name, blob);
    }
    if (pages.length === 1) await saveBlob(singleBlob,singleName);
    else await saveBlob(await zip.generateAsync({type:"blob"}), `${base}_${ext}_${pages.length}pages.zip`);
  } catch(e) {
    console.error(e); alert("画像への変換に失敗しました。");
  } finally {
    button.textContent = format === "jpeg" ? "JPGに変換" : "PNGに変換";
    updateSelectionUI();
  }
}
