const CKEDITOR_SCRIPT = "vendor/ckeditor/ckeditor.js";

const pageTitle = document.querySelector("#pageTitle");
const pageUrl = document.querySelector("#pageUrl");
const editorStatus = document.querySelector("#editorStatus");
const snapshotMeta = document.querySelector("#snapshotMeta");
const htmlSource = document.querySelector("#htmlSource");
const nativeEditor = document.querySelector("#nativeEditor");
const previewFrame = document.querySelector("#previewFrame");
const previewButton = document.querySelector("#previewButton");
const sourceButton = document.querySelector("#sourceButton");
const copyButton = document.querySelector("#copyButton");
const applyButton = document.querySelector("#applyButton");
const downloadButton = document.querySelector("#downloadButton");

const state = {
  snapshot: null,
  editorType: "native",
  ckInstance: null,
  sourceMode: false,
  previewTimer: 0
};

init();

async function init() {
  const snapshotId = new URLSearchParams(location.search).get("snapshot");
  if (!snapshotId) {
    setStatus("Missing page snapshot.");
    return;
  }

  const result = await chrome.storage.local.get(snapshotId);
  state.snapshot = result[snapshotId];
  if (!state.snapshot) {
    setStatus("Snapshot expired or could not be loaded.");
    return;
  }

  pageTitle.textContent = state.snapshot.title || "Captured website";
  pageUrl.textContent = state.snapshot.url || "";
  snapshotMeta.textContent = state.snapshot.capturedAt ? `Captured ${new Date(state.snapshot.capturedAt).toLocaleString()}` : "";
  htmlSource.value = state.snapshot.fullHtml || composeFullHtml(state.snapshot.bodyHtml || "");
  nativeEditor.innerHTML = state.snapshot.bodyHtml || "";

  wireActions();
  await startEditor();
  updatePreview();
}

function wireActions() {
  previewButton.addEventListener("click", updatePreview);
  sourceButton.addEventListener("click", toggleSourceMode);
  copyButton.addEventListener("click", copyHtml);
  applyButton.addEventListener("click", applyToSourceTab);
  downloadButton.addEventListener("click", downloadHtml);
  htmlSource.addEventListener("input", schedulePreview);
  nativeEditor.addEventListener("input", schedulePreview);
}

async function startEditor() {
  const ckLoaded = await loadCkEditor();

  if (ckLoaded && window.CKEDITOR?.replace) {
    startCkEditor4();
    return;
  }

  if (ckLoaded && (window.ClassicEditor?.create || window.InlineEditor?.create)) {
    await startCkEditor5();
    return;
  }

  state.editorType = "native";
  setStatus("CKEditor bundle not found. Using native full-page editor fallback.");
}

function startCkEditor4() {
  state.editorType = "ckeditor4";
  nativeEditor.style.display = "none";
  htmlSource.style.display = "block";
  // divarea edits body content only; the full document (doctype/head) is kept
  // in the snapshot and reassembled by composeFullHtml, same as the CKEditor 5
  // path. Seed the editor with just the body HTML.
  const bodyHtml = state.snapshot.bodyHtml || extractBodyHtml(state.snapshot.fullHtml || "");
  htmlSource.value = bodyHtml;

  state.ckInstance = window.CKEDITOR.replace(htmlSource, {
    allowedContent: true,
    height: Math.max(520, window.innerHeight - 190),
    extraAllowedContent: "*(*);*{*}",
    // Edit inside a <div> instead of an <iframe>. CKEditor 4's iframe editing
    // area bootstraps with an inline <script>, which the extension page's
    // Content Security Policy (script-src 'self') blocks. divarea avoids it.
    extraPlugins: "divarea",
    // Silence the built-in "this version is not secure" console nag.
    versionCheck: false,
    // exportpdf ships in this build but needs a cloud token URL we don't have,
    // which throws exportpdf-no-token-url on load. We don't offer PDF export.
    removePlugins: "elementspath,exportpdf",
    toolbar: [
      { name: "document", items: ["Source", "-", "Preview", "Print"] },
      { name: "clipboard", items: ["Undo", "Redo"] },
      { name: "styles", items: ["Format", "Font", "FontSize"] },
      { name: "basicstyles", items: ["Bold", "Italic", "Underline", "Strike", "RemoveFormat"] },
      { name: "paragraph", items: ["NumberedList", "BulletedList", "Blockquote"] },
      { name: "links", items: ["Link", "Unlink"] },
      { name: "insert", items: ["Image", "Table", "HorizontalRule"] }
    ]
  });

  state.ckInstance.on("change", schedulePreview);
  state.ckInstance.on("instanceReady", () => {
    setStatus("Full website loaded in CKEditor 4.");
    updatePreview();
  });
}

async function startCkEditor5() {
  state.editorType = "ckeditor5";
  htmlSource.style.display = "none";
  nativeEditor.style.display = "block";

  const Editor = window.ClassicEditor || window.InlineEditor;
  state.ckInstance = await Editor.create(nativeEditor, {
    toolbar: [
      "heading",
      "|",
      "bold",
      "italic",
      "link",
      "bulletedList",
      "numberedList",
      "|",
      "undo",
      "redo"
    ]
  });
  state.ckInstance.model.document.on("change:data", schedulePreview);
  setStatus("Website body loaded in CKEditor 5. Full document HTML is available in Source.");
}

function loadCkEditor() {
  return new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = chrome.runtime.getURL(CKEDITOR_SCRIPT);
    script.addEventListener("load", () => resolve(true), { once: true });
    script.addEventListener("error", () => resolve(false), { once: true });
    document.head.appendChild(script);
  });
}

function toggleSourceMode() {
  if (state.sourceMode) {
    const sourceHtml = htmlSource.value;
    const bodyHtml = extractBodyHtml(sourceHtml);
    if ((state.editorType === "ckeditor4" || state.editorType === "ckeditor5") && state.ckInstance) {
      state.ckInstance.setData(bodyHtml);
    } else {
      nativeEditor.innerHTML = bodyHtml;
    }
    document.body.classList.remove("is-source");
    sourceButton.textContent = "Source";
    state.sourceMode = false;
    updatePreview();
    return;
  }

  htmlSource.value = getCurrentFullHtml();
  document.body.classList.add("is-source");
  sourceButton.textContent = "Visual";
  state.sourceMode = true;
}

function getCurrentFullHtml() {
  if (state.sourceMode) {
    return htmlSource.value;
  }

  const usingCkInstance = (state.editorType === "ckeditor4" || state.editorType === "ckeditor5") && state.ckInstance;
  const bodyHtml = usingCkInstance ? state.ckInstance.getData() : nativeEditor.innerHTML;
  return composeFullHtml(bodyHtml);
}

function composeFullHtml(bodyHtml) {
  const snapshot = state.snapshot || {};
  const doctype = snapshot.doctype || "<!doctype html>";
  const htmlAttributes = snapshot.htmlAttributes ? ` ${snapshot.htmlAttributes}` : "";
  const bodyAttributes = snapshot.bodyAttributes ? ` ${snapshot.bodyAttributes}` : "";
  const headHtml = snapshot.headHtml || "";

  return `${doctype}
<html${htmlAttributes}>
<head>
<base href="${escapeHtml(snapshot.baseUrl || snapshot.url || "")}">
${headHtml}
</head>
<body${bodyAttributes}>
${bodyHtml}
</body>
</html>`;
}

function extractBodyHtml(fullHtml) {
  const parser = new DOMParser();
  const documentValue = parser.parseFromString(fullHtml, "text/html");
  return documentValue.body.innerHTML;
}

function updatePreview() {
  window.clearTimeout(state.previewTimer);
  previewFrame.srcdoc = getCurrentFullHtml();
}

function schedulePreview() {
  window.clearTimeout(state.previewTimer);
  state.previewTimer = window.setTimeout(updatePreview, 350);
}

async function copyHtml() {
  const html = getCurrentFullHtml();
  try {
    await navigator.clipboard.writeText(html);
    setStatus("HTML copied to clipboard.");
  } catch {
    htmlSource.value = html;
    htmlSource.select();
    document.execCommand("copy");
    setStatus("HTML copied to clipboard.");
  }
}

async function applyToSourceTab() {
  const sourceTabId = state.snapshot?.sourceTabId;
  if (!sourceTabId) {
    setStatus("No source tab is linked to this snapshot.");
    return;
  }

  applyButton.disabled = true;
  setStatus("Applying edited HTML to source tab.");
  try {
    const response = await chrome.runtime.sendMessage({
      type: "PAGE_STUDIO_APPLY_FULL_PAGE",
      sourceTabId,
      html: getCurrentFullHtml()
    });
    setStatus(response?.ok ? "Edited HTML applied to the source tab." : response?.error || "Unable to apply to source tab.");
  } catch {
    setStatus("Unable to apply to source tab.");
  }
  applyButton.disabled = false;
}

function downloadHtml() {
  const html = getCurrentFullHtml();
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = makeDownloadName(state.snapshot?.title || "page-studio");
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function makeDownloadName(title) {
  const safe = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "page";
  return `${safe}.html`;
}

function setStatus(message) {
  editorStatus.textContent = message;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
