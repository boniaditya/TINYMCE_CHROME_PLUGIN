const DEFAULT_SETTINGS = {
  editor: "native",
  autosave: true,
  showOutlines: true,
  sanitizeHtml: true
};

const editorSelect = document.querySelector("#editorSelect");
const autosaveInput = document.querySelector("#autosaveInput");
const outlinesInput = document.querySelector("#outlinesInput");
const sanitizeInput = document.querySelector("#sanitizeInput");
const toggleButton = document.querySelector("#toggleButton");
const openCkPageButton = document.querySelector("#openCkPageButton");
const clearDraftsButton = document.querySelector("#clearDraftsButton");
const statusText = document.querySelector("#statusText");
const stateDot = document.querySelector("#stateDot");

let active = false;
let activeTabId = null;

init();

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTabId = tab?.id ?? null;

  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  applySettings(settings);
  await refreshState();

  editorSelect.addEventListener("change", saveSettings);
  autosaveInput.addEventListener("change", saveSettings);
  outlinesInput.addEventListener("change", saveSettings);
  sanitizeInput.addEventListener("change", saveSettings);
  toggleButton.addEventListener("click", toggleEditor);
  openCkPageButton.addEventListener("click", openFullPageCkEditor);
  clearDraftsButton.addEventListener("click", clearDrafts);
}

function applySettings(settings) {
  editorSelect.value = settings.editor;
  autosaveInput.checked = settings.autosave;
  outlinesInput.checked = settings.showOutlines;
  sanitizeInput.checked = settings.sanitizeHtml;
}

function readSettings() {
  return {
    editor: editorSelect.value,
    autosave: autosaveInput.checked,
    showOutlines: outlinesInput.checked,
    sanitizeHtml: sanitizeInput.checked
  };
}

async function saveSettings() {
  const settings = readSettings();
  await chrome.storage.sync.set(settings);
  await sendMessage({ type: "PAGE_STUDIO_SETTINGS", settings });
  setStatus(active ? "Editing" : "Ready", active);
}

async function refreshState() {
  const response = await sendMessage({ type: "PAGE_STUDIO_STATE" });
  active = Boolean(response?.active);
  setStatus(active ? "Editing" : "Ready", active);
}

async function toggleEditor() {
  toggleButton.disabled = true;
  const response = await sendMessage({ type: "PAGE_STUDIO_TOGGLE" });
  active = Boolean(response?.active);
  setStatus(active ? "Editing" : "Ready", active);
  toggleButton.disabled = false;
}

async function clearDrafts() {
  clearDraftsButton.disabled = true;
  const response = await sendMessage({ type: "PAGE_STUDIO_CLEAR_DRAFTS" });
  setStatus(response?.cleared ? "Drafts cleared" : "No drafts found", active);
  clearDraftsButton.disabled = false;
}

async function openFullPageCkEditor() {
  openCkPageButton.disabled = true;
  setStatus("Opening CKEditor", active);
  let backgroundError = "";
  try {
    const response = await chrome.runtime.sendMessage({ type: "PAGE_STUDIO_OPEN_CK_FULL_PAGE" });
    if (response?.ok) {
      setStatus("CKEditor opened", active);
      return;
    }
    backgroundError = response?.error || "Background unavailable";
  } catch (error) {
    backgroundError = error?.message || "";
  } finally {
    if (!backgroundError) {
      openCkPageButton.disabled = false;
    }
  }

  await openFullPageCkEditorFromPopup(backgroundError);
  openCkPageButton.disabled = false;
}

async function openFullPageCkEditorFromPopup(previousError = "") {
  try {
    await openFullPageCkEditorDirect(previousError);
  } catch (error) {
    setStatus(error?.message || previousError || "Unable to open", active);
  }
}

async function openFullPageCkEditorDirect(previousError = "") {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    setStatus("No active tab", active);
    return;
  }

  const snapshot = await captureActiveTab(tab.id);
  if (!snapshot?.ok) {
    setStatus(snapshot?.error || previousError || "Unable to capture", active);
    return;
  }

  const snapshotId = `page-studio-ck-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await chrome.storage.local.set({
    [snapshotId]: {
      ...snapshot,
      sourceTabId: tab.id
    }
  });

  await chrome.tabs.create({
    url: chrome.runtime.getURL(`src/ck-editor-tab.html?snapshot=${encodeURIComponent(snapshotId)}`),
    active: true
  });
  setStatus("CKEditor opened", active);
}

async function captureActiveTab(tabId) {
  try {
    return await chrome.tabs.sendMessage(tabId, { type: "PAGE_STUDIO_CAPTURE_DOCUMENT" });
  } catch {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["src/content.js"]
      });
      return await chrome.tabs.sendMessage(tabId, { type: "PAGE_STUDIO_CAPTURE_DOCUMENT" });
    } catch {
      return {
        ok: false,
        error: "Cannot capture this page"
      };
    }
  }
}

function setStatus(text, isActive) {
  statusText.textContent = text;
  stateDot.classList.toggle("is-active", isActive);
  toggleButton.textContent = isActive ? "Stop Editing" : "Start Editing";
}

async function sendMessage(message) {
  if (!activeTabId) {
    setStatus("No active tab", false);
    return null;
  }

  try {
    return await chrome.tabs.sendMessage(activeTabId, message);
  } catch {
    setStatus("Unavailable here", false);
    toggleButton.disabled = true;
    return null;
  }
}
