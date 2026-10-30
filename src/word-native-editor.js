const STORAGE_KEY = "notepadHistory";

const titleInput = document.querySelector("#documentTitle");
const fileInput = document.querySelector("#fileInput");
const openButton = document.querySelector("#openButton");
const printButton = document.querySelector("#printButton");
const zoomSelect = document.querySelector("#zoomSelect");
const settingsButton = document.querySelector("#settingsButton");
const exportButton = document.querySelector("#exportButton");
const exportMenu = document.querySelector("#exportMenu");
const saveState = document.querySelector("#saveState");
const notice = document.querySelector("#notice");
const editorElement = document.querySelector("#editor");
const formatToolbar = document.querySelector("#formatToolbar");
const fontSizeSelect = document.querySelector("#fontSizeSelect");
const textColor = document.querySelector("#textColor");
const highlightColor = document.querySelector("#highlightColor");
const imageTools = document.querySelector("#imageTools");
const imageResizeHandle = document.querySelector("#imageResizeHandle");
const cropDialog = document.querySelector("#cropDialog");
const cropCanvas = document.querySelector("#cropCanvas");
const cropFrame = document.querySelector("#cropFrame");
const applyCropButton = document.querySelector("#applyCropButton");
const cropInputs = ["cropLeft", "cropRight", "cropTop", "cropBottom"].map((id) => document.querySelector(`#${id}`));

const state = {
  id: new URLSearchParams(location.search).get("id"),
  record: null,
  editor: null,
  saveTimer: 0,
  sourceFormat: "docx",
  sourceName: "Untitled.docx",
  zoom: 1,
  savedRange: null,
  selectedImage: null,
  cropImage: null
};

init();

async function init() {
  const requiredElements = {
    titleInput, fileInput, openButton, printButton, zoomSelect, settingsButton, exportButton,
    exportMenu, saveState, notice, editorElement, formatToolbar,
    fontSizeSelect, textColor, highlightColor, imageTools, imageResizeHandle,
    cropDialog, cropCanvas, cropFrame, applyCropButton, ...cropInputs
  };
  const missingElements = Object.entries(requiredElements).filter(([, element]) => !element).map(([name]) => name);
  if (missingElements.length) {
    console.error(`Word editor UI mismatch: missing ${missingElements.join(", ")}`);
    return;
  }
  if (!state.id) return showNotice("This Word document is missing its library id.", true);
  state.record = await getRecord();
  if (!state.record) return showNotice("This Word document could not be found in the library.", true);

  titleInput.value = state.record.title || "Untitled document";
  state.sourceFormat = state.record.sourceFormat || "docx";
  state.sourceName = state.record.sourceName || `${safeFilename(titleInput.value)}.${state.sourceFormat}`;
  const settingsData = await chrome.storage.local.get("notepadSettings");
  const defaultZoom = Number(settingsData.notepadSettings?.wordDefaultZoom) || 1;
  state.zoom = Number(state.record.viewZoom) || defaultZoom;
  zoomSelect.value = String(state.zoom);
  applyZoom();

  try {
    state.editor = await createEditor(state.record.content || "<p>Start writing, or open a local Word document.</p>");
  } catch (error) {
    console.error(error);
    showNotice("The local Word editor could not start. Reload the extension and try again.", true);
    return;
  }

  titleInput.addEventListener("input", scheduleSave);
  editorElement.addEventListener("input", scheduleSave);
  installFormattingToolbar();
  installImageEditing();
  openButton.addEventListener("click", () => fileInput.click());
  printButton.addEventListener("click", () => window.print());
  settingsButton.addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("src/settings.html"), active: true }));
  zoomSelect.addEventListener("change", changeZoom);
  fileInput.addEventListener("change", importSelectedFile);
  exportButton.addEventListener("click", toggleExportMenu);
  exportMenu.addEventListener("click", exportSelectedFormat);
  document.addEventListener("click", closeExportMenuFromOutside);
  window.addEventListener("beforeunload", saveNow);
  state.editor.focus();
}

function installImageEditing() {
  editorElement.addEventListener("click", (event) => {
    const image = event.target.closest("img");
    if (image && editorElement.contains(image)) {
      event.preventDefault();
      selectImage(image);
    } else {
      clearImageSelection();
    }
  });
  imageTools.addEventListener("click", handleImageToolClick);
  imageResizeHandle.addEventListener("pointerdown", startImageResize);
  cropInputs.forEach((input) => input.addEventListener("input", updateCropPreview));
  cropDialog.addEventListener("click", (event) => {
    if (event.target.closest("[data-crop-close]")) closeCropDialog();
  });
  applyCropButton.addEventListener("click", applyImageCrop);
  window.addEventListener("scroll", positionImageControls, true);
  window.addEventListener("resize", positionImageControls);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (!cropDialog.hidden) closeCropDialog();
      else clearImageSelection();
    }
  });
}

function selectImage(image) {
  clearImageSelection();
  state.selectedImage = image;
  image.classList.add("is-selected-image");
  imageTools.hidden = false;
  imageResizeHandle.hidden = false;
  positionImageControls();
}

function clearImageSelection() {
  state.selectedImage?.classList.remove("is-selected-image");
  state.selectedImage = null;
  imageTools.hidden = true;
  imageResizeHandle.hidden = true;
}

function positionImageControls() {
  const image = state.selectedImage;
  if (!image?.isConnected) return clearImageSelection();
  const rect = image.getBoundingClientRect();
  const toolbarWidth = imageTools.offsetWidth || 340;
  imageTools.style.left = `${Math.max(8, Math.min(window.innerWidth - toolbarWidth - 8, rect.left))}px`;
  imageTools.style.top = `${Math.max(8, rect.top - imageTools.offsetHeight - 9)}px`;
  imageResizeHandle.style.left = `${rect.right - 8}px`;
  imageResizeHandle.style.top = `${rect.bottom - 8}px`;
}

function handleImageToolClick(event) {
  const action = event.target.closest("[data-image-action]")?.dataset.imageAction;
  const image = state.selectedImage;
  if (!action || !image) return;
  if (["small", "medium", "large"].includes(action)) {
    image.style.width = ({ small: "25%", medium: "50%", large: "100%" })[action];
    image.style.height = "auto";
    positionImageControls();
    scheduleSave();
  } else if (action === "crop") {
    openCropDialog(image);
  } else if (action === "alt") {
    const value = window.prompt("Describe this image", image.alt || "");
    if (value !== null) { image.alt = value.trim(); scheduleSave(); }
  } else if (action === "remove") {
    image.remove();
    clearImageSelection();
    scheduleSave();
  }
}

function startImageResize(event) {
  const image = state.selectedImage;
  if (!image) return;
  event.preventDefault();
  imageResizeHandle.setPointerCapture(event.pointerId);
  const startX = event.clientX;
  const startWidth = image.getBoundingClientRect().width;
  const maxWidth = editorElement.getBoundingClientRect().width - 20;
  const move = (moveEvent) => {
    const width = Math.max(60, Math.min(maxWidth, startWidth + moveEvent.clientX - startX));
    image.style.width = `${Math.round(width)}px`;
    image.style.height = "auto";
    positionImageControls();
  };
  const end = () => {
    imageResizeHandle.removeEventListener("pointermove", move);
    imageResizeHandle.removeEventListener("pointerup", end);
    imageResizeHandle.removeEventListener("pointercancel", end);
    scheduleSave();
  };
  imageResizeHandle.addEventListener("pointermove", move);
  imageResizeHandle.addEventListener("pointerup", end);
  imageResizeHandle.addEventListener("pointercancel", end);
}

async function openCropDialog(image) {
  try {
    const source = await loadImage(image.src);
    state.cropImage = source;
    cropCanvas.width = source.naturalWidth;
    cropCanvas.height = source.naturalHeight;
    cropCanvas.getContext("2d").drawImage(source, 0, 0);
    cropInputs.forEach((input) => { input.value = "0"; });
    cropDialog.hidden = false;
    updateCropPreview();
  } catch (error) {
    console.error(error);
    showNotice("This image could not be prepared for cropping.", true);
  }
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

function updateCropPreview() {
  if (cropDialog.hidden || !state.cropImage) return;
  cropInputs.forEach((input) => { input.nextElementSibling.textContent = `${input.value}%`; });
  const [left, right, top, bottom] = cropInputs.map((input) => Number(input.value));
  const canvasRect = cropCanvas.getBoundingClientRect();
  cropFrame.style.left = `${cropCanvas.offsetLeft + canvasRect.width * left / 100}px`;
  cropFrame.style.top = `${cropCanvas.offsetTop + canvasRect.height * top / 100}px`;
  cropFrame.style.width = `${canvasRect.width * (100 - left - right) / 100}px`;
  cropFrame.style.height = `${canvasRect.height * (100 - top - bottom) / 100}px`;
}

function applyImageCrop() {
  const target = state.selectedImage;
  const source = state.cropImage;
  if (!target || !source) return closeCropDialog();
  const [left, right, top, bottom] = cropInputs.map((input) => Number(input.value) / 100);
  const sourceX = Math.round(source.naturalWidth * left);
  const sourceY = Math.round(source.naturalHeight * top);
  const sourceWidth = Math.max(1, Math.round(source.naturalWidth * (1 - left - right)));
  const sourceHeight = Math.max(1, Math.round(source.naturalHeight * (1 - top - bottom)));
  const output = document.createElement("canvas");
  output.width = sourceWidth;
  output.height = sourceHeight;
  output.getContext("2d").drawImage(source, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, sourceWidth, sourceHeight);
  target.src = output.toDataURL("image/png");
  target.style.height = "auto";
  closeCropDialog();
  positionImageControls();
  scheduleSave();
}

function closeCropDialog() {
  cropDialog.hidden = true;
  state.cropImage = null;
}

async function createEditor(content) {
  editorElement.innerHTML = sanitizeImportedHtml(content);
  return {
    getData: serializeEditorContent,
    setData: (html) => { editorElement.innerHTML = sanitizeImportedHtml(html); },
    focus: () => editorElement.focus()
  };
}

function serializeEditorContent() {
  const clone = editorElement.cloneNode(true);
  clone.querySelectorAll(".is-selected-image").forEach((image) => image.classList.remove("is-selected-image"));
  return clone.innerHTML;
}

function installFormattingToolbar() {
  document.execCommand("styleWithCSS", false, true);
  formatToolbar.addEventListener("mousedown", (event) => {
    if (!event.target.closest("input[type=color], select")) event.preventDefault();
    rememberSelection();
  });
  formatToolbar.addEventListener("click", handleToolbarClick);
  formatToolbar.addEventListener("change", handleToolbarChange);
  editorElement.addEventListener("keyup", rememberSelection);
  editorElement.addEventListener("mouseup", rememberSelection);
  document.addEventListener("selectionchange", updateToolbarState);
}

function handleToolbarClick(event) {
  const button = event.target.closest("button");
  if (!button) return;
  restoreSelection();
  if (button.dataset.command) {
    document.execCommand(button.dataset.command, false, null);
  } else {
    runToolbarAction(button.dataset.action);
  }
  editorElement.focus();
  rememberSelection();
  scheduleSave();
  updateToolbarState();
}

function handleToolbarChange(event) {
  const select = event.target.closest("select[data-command]");
  if (select) {
    restoreSelection();
    document.execCommand(select.dataset.command, false, select.value);
    editorElement.focus();
    scheduleSave();
  }
}

function runToolbarAction(action) {
  if (action === "link") {
    const url = window.prompt("Link URL", "https://");
    if (url?.trim()) document.execCommand("createLink", false, url.trim());
  } else if (action === "table") {
    insertHtmlAtSelection(makeTableHtml(3, 3));
  } else if (action === "image") {
    chooseInlineImage();
  } else if (action === "rule") {
    document.execCommand("insertHorizontalRule", false, null);
  } else if (action === "page-break") {
    insertHtmlAtSelection('<span class="page-break" contenteditable="false" aria-label="Page break"></span><p><br></p>');
  } else if (action === "clear") {
    document.execCommand("removeFormat", false, null);
    document.execCommand("unlink", false, null);
  }
}

function makeTableHtml(rows, columns) {
  let html = "<table><tbody>";
  for (let row = 0; row < rows; row += 1) {
    html += "<tr>";
    for (let column = 0; column < columns; column += 1) html += "<td><br></td>";
    html += "</tr>";
  }
  return `${html}</tbody></table><p><br></p>`;
}

function chooseInlineImage() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/png,image/jpeg,image/gif,image/webp";
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      restoreSelection();
      insertHtmlAtSelection(`<img src="${reader.result}" alt="${escapeHtml(file.name)}"><p><br></p>`);
      scheduleSave();
    });
    reader.readAsDataURL(file);
  });
  input.click();
}

function insertHtmlAtSelection(html) {
  restoreSelection();
  document.execCommand("insertHTML", false, html);
}

function rememberSelection() {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return;
  const range = selection.getRangeAt(0);
  if (editorElement.contains(range.commonAncestorContainer)) state.savedRange = range.cloneRange();
}

function restoreSelection() {
  if (!state.savedRange) return editorElement.focus();
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(state.savedRange);
}

function updateToolbarState() {
  if (!document.activeElement || (!editorElement.contains(document.activeElement) && document.activeElement !== editorElement)) return;
  for (const command of ["bold", "italic", "underline", "strikeThrough", "justifyLeft", "justifyCenter", "justifyRight", "justifyFull", "insertOrderedList", "insertUnorderedList"]) {
    formatToolbar.querySelector(`[data-command="${command}"]`)?.classList.toggle("is-active", document.queryCommandState(command));
  }
}

fontSizeSelect?.addEventListener("change", () => {
  restoreSelection();
  document.execCommand("fontSize", false, "7");
  editorElement.querySelectorAll('font[size="7"]').forEach((node) => {
    node.removeAttribute("size");
    node.style.fontSize = `${fontSizeSelect.value}pt`;
  });
  scheduleSave();
});

textColor?.addEventListener("input", () => {
  restoreSelection();
  document.execCommand("foreColor", false, textColor.value);
  scheduleSave();
});

highlightColor?.addEventListener("input", () => {
  restoreSelection();
  document.execCommand("hiliteColor", false, highlightColor.value);
  scheduleSave();
});

async function importSelectedFile() {
  const file = fileInput.files?.[0];
  fileInput.value = "";
  if (!file) return;
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension !== "doc" && extension !== "docx") {
    return showNotice("Choose a .doc or .docx file.", true);
  }

  setBusy(true, `Opening ${file.name}…`);
  try {
    let html;
    if (extension === "docx") {
      if (!window.docshift?.toHtml) throw new Error("docx-importer-unavailable");
      html = await window.docshift.toHtml(file);
    } else {
      if (typeof window.docToText?.html !== "function") throw new Error("doc-importer-unavailable");
      html = window.docToText.html(await file.arrayBuffer());
      if (!html) throw new Error("unsupported-doc");
      html = typeof html === "string" ? html : html.body;
    }

    state.sourceFormat = extension;
    state.sourceName = file.name;
    titleInput.value = file.name.replace(/\.(docx?|DOCX?)$/, "") || "Untitled document";
    state.editor.setData(sanitizeImportedHtml(html || ""));
    await saveNow();
    showNotice(`${file.name} opened locally. Complex page layout may be simplified during editing.`);
  } catch (error) {
    console.error(error);
    showNotice(extension === "doc"
      ? "This legacy .doc file is encrypted, damaged, or uses an unsupported pre-Word-97 format."
      : "This .docx file could not be converted for editing.", true);
  } finally {
    setBusy(false);
  }
}

function sanitizeImportedHtml(html) {
  const parsed = new DOMParser().parseFromString(String(html), "text/html");
  parsed.querySelectorAll("script, style, iframe, object, embed, form, input, button, meta, link").forEach((node) => node.remove());
  parsed.querySelectorAll("*").forEach((node) => {
    for (const attribute of [...node.attributes]) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim().toLowerCase();
      if (name.startsWith("on") || ((name === "href" || name === "src") && value.startsWith("javascript:"))) {
        node.removeAttribute(attribute.name);
      }
    }
  });
  return parsed.body.innerHTML;
}

function scheduleSave() {
  saveState.textContent = "Saving…";
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(saveNow, 500);
}

async function saveNow() {
  clearTimeout(state.saveTimer);
  if (!state.editor || !state.record) return;
  const notes = await getNotes();
  const index = notes.findIndex((note) => note.id === state.id);
  if (index < 0) return;
  notes[index] = {
    ...notes[index],
    type: "word",
    title: titleInput.value.trim() || "Untitled document",
    content: state.editor.getData(),
    sourceFormat: state.sourceFormat,
    sourceName: state.sourceName,
    viewZoom: state.zoom,
    updatedAt: Date.now()
  };
  state.record = notes[index];
  await chrome.storage.local.set({ [STORAGE_KEY]: notes });
  saveState.textContent = "Saved locally";
}

function changeZoom() {
  state.zoom = Number(zoomSelect.value) || 1;
  applyZoom();
  scheduleSave();
}

function applyZoom() {
  document.documentElement.style.setProperty("--word-zoom", String(state.zoom));
}

function toggleExportMenu() {
  exportMenu.hidden = !exportMenu.hidden;
  exportButton.setAttribute("aria-expanded", String(!exportMenu.hidden));
}

function closeExportMenuFromOutside(event) {
  if (!event.target.closest(".word__export")) closeExportMenu();
}

function closeExportMenu() {
  exportMenu.hidden = true;
  exportButton.setAttribute("aria-expanded", "false");
}

async function exportSelectedFormat(event) {
  const format = event.target.closest("[data-format]")?.dataset.format;
  if (!format) return;
  closeExportMenu();
  setBusy(true, `Preparing .${format}…`);
  try {
    await saveNow();
    const html = state.editor.getData();
    const name = safeFilename(titleInput.value || "Untitled document");
    if (format === "docx") {
      if (!window.docshift?.toDocx) throw new Error("docx-exporter-unavailable");
      downloadBlob(await window.docshift.toDocx(html), `${name}.docx`);
    } else if (format === "doc") {
      if (typeof window.textToDoc !== "function") throw new Error("doc-exporter-unavailable");
      downloadBlob(new Blob([window.textToDoc(htmlToLegacyModel(html))], { type: "application/msword" }), `${name}.doc`);
    } else {
      const documentHtml = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(titleInput.value)}</title></head><body>${html}</body></html>`;
      downloadBlob(new Blob([documentHtml], { type: "text/html;charset=utf-8" }), `${name}.html`);
    }
    showNotice(`Exported ${name}.${format}`);
  } catch (error) {
    console.error(error);
    showNotice(`Could not export this document as .${format}.`, true);
  } finally {
    setBusy(false);
  }
}

function htmlToLegacyModel(html) {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const output = [];
  const blocks = parsed.body.querySelectorAll("p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, table");
  for (const block of blocks) {
    if (block.closest("table") && block.tagName !== "TABLE") continue;
    if (block.tagName === "TABLE") {
      for (const row of block.rows) {
        for (const cell of row.cells) output.push({ kind: "cell", runs: inlineRuns(cell) });
        output.push({ kind: "rowEnd", runs: [] });
      }
      continue;
    }
    const list = block.tagName === "LI" ? block.closest("ol") || block.closest("ul") : null;
    output.push({
      kind: "p",
      runs: inlineRuns(block),
      list: list ? { kind: list.tagName === "OL" ? "number" : "bullet", ilvl: nestedListDepth(block) } : null,
      align: paragraphAlignment(block)
    });
  }
  return output.length ? output : [{ kind: "p", runs: [{ text: parsed.body.textContent || "" }] }];
}

function inlineRuns(root) {
  const runs = [];
  const visit = (node, style) => {
    if (node.nodeType === Node.TEXT_NODE) {
      if (node.nodeValue) runs.push({ text: node.nodeValue, ...style });
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const tag = node.tagName;
    const next = {
      ...style,
      b: style.b || tag === "STRONG" || tag === "B",
      i: style.i || tag === "EM" || tag === "I",
      u: style.u || tag === "U",
      strike: style.strike || tag === "S" || tag === "STRIKE" || tag === "DEL",
      ...inlineStyle(node)
    };
    if (tag === "BR") runs.push({ text: "\n", ...next });
    else [...node.childNodes].forEach((child) => visit(child, next));
  };
  [...root.childNodes].forEach((node) => visit(node, {}));
  return runs;
}

function inlineStyle(node) {
  const style = node.style;
  const run = {};
  if (node.tagName === "A" && node.href) run.url = node.href;
  if (style?.fontFamily) run.font = style.fontFamily.split(",")[0].replace(/["']/g, "").trim();
  if (style?.fontSize) run.size = cssSizeToPoints(style.fontSize);
  if (/^(H1|H2|H3|H4|H5|H6)$/.test(node.tagName)) {
    run.b = true;
    run.size = ({ H1: 24, H2: 20, H3: 16, H4: 14, H5: 12, H6: 11 })[node.tagName];
  }
  const color = cssColorToColorRef(style?.color);
  const highlight = cssColorToColorRef(style?.backgroundColor);
  if (color != null) run.color = color;
  if (highlight != null) run.highlight = highlight;
  return run;
}

function paragraphAlignment(element) {
  const value = element.style?.textAlign || "";
  return ({ center: 1, right: 2, justify: 3 })[value] || 0;
}

function cssSizeToPoints(value) {
  const number = parseFloat(value);
  if (!Number.isFinite(number)) return null;
  if (value.endsWith("px")) return Math.round(number * 0.75 * 2) / 2;
  return number;
}

function cssColorToColorRef(value) {
  if (!value || value === "transparent") return null;
  let red; let green; let blue;
  const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const raw = hex[1].length === 3 ? [...hex[1]].map((part) => part + part).join("") : hex[1];
    red = parseInt(raw.slice(0, 2), 16); green = parseInt(raw.slice(2, 4), 16); blue = parseInt(raw.slice(4, 6), 16);
  } else {
    const rgb = value.match(/rgba?\(\s*(\d+)\D+(\d+)\D+(\d+)/i);
    if (!rgb) return null;
    red = Number(rgb[1]); green = Number(rgb[2]); blue = Number(rgb[3]);
  }
  return red | (green << 8) | (blue << 16);
}

function nestedListDepth(item) {
  let depth = 0;
  let parent = item.parentElement;
  while (parent) {
    if (parent.tagName === "UL" || parent.tagName === "OL") depth += 1;
    parent = parent.parentElement;
  }
  return Math.max(0, depth - 1);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function setBusy(busy, message) {
  openButton.disabled = busy;
  exportButton.disabled = busy;
  if (busy) saveState.textContent = message;
  else if (saveState.textContent !== "Saving…") saveState.textContent = "Saved locally";
}

function showNotice(message, error = false) {
  notice.textContent = message;
  notice.hidden = false;
  notice.style.background = error ? "#fff0f0" : "#fff8dc";
  notice.style.color = error ? "#8b2525" : "#63531f";
}

async function getNotes() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  return Array.isArray(data[STORAGE_KEY]) ? data[STORAGE_KEY] : [];
}

async function getRecord() {
  return (await getNotes()).find((note) => note.id === state.id) || null;
}

function safeFilename(value) {
  return String(value || "Untitled document").replace(/[\\/:*?"<>|]+/g, "-").trim() || "Untitled document";
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}
