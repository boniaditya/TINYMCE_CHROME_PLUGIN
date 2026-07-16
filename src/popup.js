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

const newNoteButton = document.querySelector("#newNoteButton");
const notesClearAll = document.querySelector("#notesClearAll");
const noteList = document.querySelector("#noteList");
const notesEmpty = document.querySelector("#notesEmpty");
const notesTitle = document.querySelector("#notesTitle");
const editorModal = document.querySelector("#editorModal");

const NOTES_KEY = "notepadHistory";
const NOTEPAD_BASE = "https://notepad.pw/";
const EDITOR_LABELS = {
  tinymce: "TinyMCE",
  ckeditor: "CKEditor",
  tiptap: "Tiptap",
  jck: "JCK",
  plain: "Plain Text",
  native: "Rich Text"
};

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

  await initNotes();
}

async function initNotes() {
  newNoteButton.addEventListener("click", openEditorModal);
  notesClearAll.addEventListener("click", clearAllNotes);

  editorModal.addEventListener("click", (event) => {
    if (event.target.closest("[data-close]")) {
      closeEditorModal();
      return;
    }
    const option = event.target.closest("[data-editor]");
    if (option) {
      chooseEditor(option.dataset.editor);
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !editorModal.hidden) {
      closeEditorModal();
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[NOTES_KEY]) {
      renderNotes();
    }
  });
  await renderNotes();
}

function openEditorModal() {
  editorModal.hidden = false;
}

function closeEditorModal() {
  editorModal.hidden = true;
}

async function chooseEditor(editor) {
  closeEditorModal();
  if (editor === "notepad") {
    await createNotepadNote();
  } else {
    await createEditorNote(editor);
  }
}

function makeNoteSlug() {
  const random = (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`)
    .replace(/-/g, "")
    .slice(0, 12);
  return `note-${random}`;
}

async function getNotes() {
  const data = await chrome.storage.local.get(NOTES_KEY);
  return Array.isArray(data[NOTES_KEY]) ? data[NOTES_KEY] : [];
}

async function createNotepadNote() {
  const slug = makeNoteSlug();
  const url = `${NOTEPAD_BASE}${slug}`;
  const notes = await getNotes();
  notes.unshift({ id: slug, type: "notepad", url, title: formatNoteTitle(new Date()), createdAt: Date.now() });
  await chrome.storage.local.set({ [NOTES_KEY]: notes });
  await chrome.tabs.create({ url, active: true });
  await renderNotes();
}

async function createEditorNote(editor) {
  const id = makeNoteSlug();
  const label = EDITOR_LABELS[editor] || "Note";
  const notes = await getNotes();
  notes.unshift({
    id,
    type: editor,
    title: `${label} note`,
    content: "",
    createdAt: Date.now()
  });
  await chrome.storage.local.set({ [NOTES_KEY]: notes });
  await chrome.tabs.create({
    url: chrome.runtime.getURL(`src/note-editor.html?id=${encodeURIComponent(id)}`),
    active: true
  });
  await renderNotes();
}

function openNoteTarget(note) {
  const url = note.type && note.type !== "notepad"
    ? chrome.runtime.getURL(`src/note-editor.html?id=${encodeURIComponent(note.id)}`)
    : note.url;
  chrome.tabs.create({ url, active: true });
}

async function deleteNote(id) {
  const notes = await getNotes();
  await chrome.storage.local.set({ [NOTES_KEY]: notes.filter((note) => note.id !== id) });
  await renderNotes();
}

async function clearAllNotes() {
  await chrome.storage.local.set({ [NOTES_KEY]: [] });
  await renderNotes();
}

function formatNoteTitle(date) {
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

async function renderNotes() {
  const notes = await getNotes();
  noteList.innerHTML = "";
  const hasNotes = notes.length > 0;
  notesEmpty.hidden = hasNotes;
  notesClearAll.hidden = !hasNotes;
  notesTitle.textContent = hasNotes ? `Notes (${notes.length})` : "Notes";

  for (const note of notes) {
    noteList.appendChild(renderNoteItem(note));
  }
}

function renderNoteItem(note) {
  const item = document.createElement("li");
  item.className = "note-item";

  const body = document.createElement("div");
  body.className = "note-item__body";
  body.setAttribute("role", "button");
  body.tabIndex = 0;

  const title = document.createElement("div");
  title.className = "note-item__title";
  title.textContent = note.title;

  const meta = document.createElement("p");
  meta.className = "note-item__meta";
  meta.textContent = note.type && note.type !== "notepad"
    ? `${EDITOR_LABELS[note.type] || "Editor"} note`
    : (note.url || "").replace(/^https?:\/\//, "");

  body.append(title, meta);
  const open = () => openNoteTarget(note);
  body.addEventListener("click", open);
  body.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      open();
    }
  });

  const del = document.createElement("button");
  del.className = "note-item__delete";
  del.type = "button";
  del.title = "Delete note";
  del.setAttribute("aria-label", "Delete note");
  del.textContent = "×";
  del.addEventListener("click", (event) => {
    event.stopPropagation();
    deleteNote(note.id);
  });

  item.append(body, del);
  return item;
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
