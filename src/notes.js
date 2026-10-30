const STORAGE_KEY = "notepadHistory";
const NOTEPAD_BASE = "https://notepad.pw/";
const NOTEPADCC_BASE = "https://notepad.cc/";
const EDITOR_LABELS = {
  word: "Word Document",
  ckeditor: "CKEditor",
  tinymce: "TinyMCE",
  tiptap: "Tiptap",
  milkdown: "Milkdown",
  markdown: "Markdown",
  plain: "Plain Text",
  native: "Rich Text"
};

const newNoteButton = document.querySelector("#newNoteButton");
const clearAllButton = document.querySelector("#clearAllButton");
const noteList = document.querySelector("#noteList");
const emptyState = document.querySelector("#emptyState");
const listTitle = document.querySelector("#listTitle");
const editorModal = document.querySelector("#editorModal");
const exportBackupButton = document.querySelector("#exportBackupButton");
const restoreBackupButton = document.querySelector("#restoreBackupButton");
const restoreBackupInput = document.querySelector("#restoreBackupInput");
const backupStatus = document.querySelector("#backupStatus");
const settingsButton = document.querySelector("#settingsButton");
let appSettings = {};

init();

async function init() {
  // Wire controls first so a rendering hiccup can never leave buttons dead.
  const settingsData = await chrome.storage.local.get("notepadSettings");
  appSettings = settingsData.notepadSettings || {};
  newNoteButton.addEventListener("click", handleNewNote);
  settingsButton.addEventListener("click", openSettings);
  clearAllButton.addEventListener("click", clearAll);
  exportBackupButton.addEventListener("click", exportFullBackup);
  restoreBackupButton.addEventListener("click", () => restoreBackupInput.click());
  restoreBackupInput.addEventListener("change", restoreFullBackup);

  editorModal.addEventListener("click", (event) => {
    if (event.target.closest("[data-close]")) {
      editorModal.hidden = true;
      return;
    }
    const option = event.target.closest("[data-editor]");
    if (option) {
      editorModal.hidden = true;
      chooseEditor(option.dataset.editor);
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !editorModal.hidden) {
      editorModal.hidden = true;
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[STORAGE_KEY]) render();
  });

  await render();
}

function handleNewNote() {
  if (appSettings.defaultEditor) chooseEditor(appSettings.defaultEditor);
  else editorModal.hidden = false;
}

function openSettings() {
  chrome.tabs.create({ url: chrome.runtime.getURL("src/settings.html"), active: true });
}

async function exportFullBackup() {
  setBackupBusy(true);
  showBackupStatus("Preparing backup…");
  try {
    const data = await chrome.storage.local.get(null);
    const dataJson = JSON.stringify(data);
    const backup = {
      format: "notepad-library-backup",
      schemaVersion: 1,
      extensionVersion: chrome.runtime.getManifest().version,
      exportedAt: new Date().toISOString(),
      checksum: await sha256(dataJson),
      summary: {
        notes: Array.isArray(data.notepadHistory) ? data.notepadHistory.length : 0,
        folders: Array.isArray(data.notepadFolders) ? data.notepadFolders.length : 0,
        historyLinks: Array.isArray(data.notepadLinkHistory) ? data.notepadLinkHistory.length : 0
      },
      data
    };
    const date = new Date().toISOString().slice(0, 10);
    downloadBackup(new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }), `notepad-library-backup-${date}.json`);
    showBackupStatus(`Backup saved: ${backup.summary.notes} notes and ${backup.summary.folders} folders.`);
  } catch (error) {
    console.error(error);
    showBackupStatus("The backup could not be created.", true);
  } finally {
    setBackupBusy(false);
  }
}

async function restoreFullBackup() {
  const file = restoreBackupInput.files?.[0];
  restoreBackupInput.value = "";
  if (!file) return;
  if (file.size > 100 * 1024 * 1024) {
    return showBackupStatus("This backup is larger than the supported 100 MB limit.", true);
  }

  setBackupBusy(true);
  showBackupStatus("Checking backup…");
  try {
    const backup = JSON.parse(await file.text());
    validateBackup(backup);
    const dataJson = JSON.stringify(backup.data);
    if (backup.checksum && await sha256(dataJson) !== backup.checksum) {
      throw new Error("backup-checksum-mismatch");
    }
    const notes = Array.isArray(backup.data.notepadHistory) ? backup.data.notepadHistory.length : 0;
    const folders = Array.isArray(backup.data.notepadFolders) ? backup.data.notepadFolders.length : 0;
    const confirmed = window.confirm(`Restore ${notes} notes and ${folders} folders? This will replace the data currently stored in Notepad Library.`);
    if (!confirmed) {
      showBackupStatus("Restore cancelled.");
      return;
    }

    const safeData = safeStorageObject(backup.data);
    await chrome.storage.local.clear();
    if (Object.keys(safeData).length) await chrome.storage.local.set(safeData);
    await render();
    showBackupStatus(`Restore complete: ${notes} notes and ${folders} folders recovered.`);
  } catch (error) {
    console.error(error);
    showBackupStatus(error?.message === "backup-checksum-mismatch"
      ? "This backup is damaged or was modified after it was created."
      : "This is not a valid Notepad Library backup file.", true);
  } finally {
    setBackupBusy(false);
  }
}

function validateBackup(backup) {
  if (!backup || typeof backup !== "object" || Array.isArray(backup)) throw new Error("invalid-backup");
  if (backup.format !== "notepad-library-backup") throw new Error("invalid-backup-format");
  if (!Number.isInteger(backup.schemaVersion) || backup.schemaVersion < 1 || backup.schemaVersion > 1) throw new Error("unsupported-backup-version");
  if (!backup.data || typeof backup.data !== "object" || Array.isArray(backup.data)) throw new Error("invalid-backup-data");
  if (backup.data.notepadHistory !== undefined && !Array.isArray(backup.data.notepadHistory)) throw new Error("invalid-notes");
  if (backup.data.notepadFolders !== undefined && !Array.isArray(backup.data.notepadFolders)) throw new Error("invalid-folders");
}

function safeStorageObject(data) {
  return Object.fromEntries(Object.entries(data).filter(([key]) => !["__proto__", "prototype", "constructor"].includes(key)));
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function downloadBackup(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function setBackupBusy(busy) {
  exportBackupButton.disabled = busy;
  restoreBackupButton.disabled = busy;
}

function showBackupStatus(message, error = false) {
  backupStatus.textContent = message;
  backupStatus.hidden = false;
  backupStatus.classList.toggle("backup__status--error", error);
}

function makeSlug() {
  const random = (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`)
    .replace(/-/g, "")
    .slice(0, 12);
  return `note-${random}`;
}

async function getNotes() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  return Array.isArray(data[STORAGE_KEY]) ? data[STORAGE_KEY] : [];
}

async function saveNotes(notes) {
  await chrome.storage.local.set({ [STORAGE_KEY]: notes });
}

async function chooseEditor(editor) {
  if (editor === "notepad") {
    await createNotepadNote(NOTEPAD_BASE);
  } else if (editor === "notepadcc") {
    await createNotepadNote(NOTEPADCC_BASE);
  } else {
    await createEditorNote(editor);
  }
}

async function createNotepadNote(base) {
  const slug = makeSlug();
  const url = `${base}${slug}`;
  const notes = await getNotes();
  notes.unshift({ id: slug, type: "notepad", url, title: formatTitle(new Date()), createdAt: Date.now() });
  await saveNotes(notes);
  await chrome.tabs.create({ url, active: true });
  await render();
}

async function createEditorNote(editor) {
  const id = makeSlug();
  const label = EDITOR_LABELS[editor] || "Note";
  const notes = await getNotes();
  notes.unshift({ id, type: editor, title: `${label} note`, content: "", createdAt: Date.now() });
  await saveNotes(notes);
  const url = extensionUrl(editorPagePath(id, editor));
  if (url) await chrome.tabs.create({ url, active: true });
  await render();
}

function isEditorNote(note) {
  return Boolean(note.type) && note.type !== "notepad";
}

function openNote(note) {
  const url = isEditorNote(note)
    ? extensionUrl(editorPagePath(note.id, note.type))
    : note.url;
  if (url) chrome.tabs.create({ url, active: true });
}

function editorPagePath(id, type) {
  const page = type === "word" ? "word-editor.html" : "note-editor.html";
  return `src/${page}?id=${encodeURIComponent(id)}`;
}

function extensionUrl(path) {
  try {
    return chrome.runtime.getURL(path);
  } catch {
    return "";
  }
}

async function deleteNote(id) {
  if (appSettings.confirmDelete !== false && !window.confirm("Delete this note?")) return;
  const notes = await getNotes();
  await saveNotes(notes.filter((note) => note.id !== id));
  await render();
}

async function clearAll() {
  if (appSettings.confirmDelete !== false && !window.confirm("Delete all notes? This cannot be undone unless you have a backup.")) return;
  await saveNotes([]);
  await render();
}

function formatTitle(date) {
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

async function render() {
  const notes = await getNotes();
  noteList.innerHTML = "";

  const hasNotes = notes.length > 0;
  emptyState.hidden = hasNotes;
  clearAllButton.hidden = !hasNotes;
  listTitle.textContent = hasNotes ? `Recent notes (${notes.length})` : "Recent notes";

  for (const note of notes) {
    noteList.appendChild(renderNote(note));
  }
}

const PW_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="20" height="20"><defs><linearGradient id="pwico" x1="0.15" y1="0.05" x2="0.9" y2="1"><stop offset="0" stop-color="#d24fd0"/><stop offset="0.55" stop-color="#a935bf"/><stop offset="1" stop-color="#7a1f9e"/></linearGradient><linearGradient id="pwfold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6a1a8f"/><stop offset="1" stop-color="#4e1170"/></linearGradient></defs><path d="M8 4C24 3 30 13 28 23 26.5 30 19 31 13 27.5 22 24 22 13 8 4Z" fill="url(#pwico)"/><path d="M13 27.5C8.5 25 7 18.5 9 13.5 13 17.5 15 23 13 27.5Z" fill="url(#pwfold)"/></svg>`;
const CC_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="20" height="20"><rect x="5.5" y="7" width="21" height="21" rx="3.5" fill="#ffffff" stroke="#8b98a3" stroke-width="1.6"/><g stroke="#cbd4da" stroke-width="1.7" stroke-linecap="round"><line x1="9" y1="13" x2="23" y2="13"/><line x1="9" y1="17" x2="23" y2="17"/><line x1="9" y1="21" x2="19" y2="21"/></g><rect x="6.6" y="23.4" width="18.8" height="3.4" rx="1.7" fill="#3d9be0"/><g fill="#2b2f33"><rect x="9" y="3.4" width="2.6" height="7.2" rx="1.3"/><rect x="14.7" y="3.4" width="2.6" height="7.2" rx="1.3"/><rect x="20.4" y="3.4" width="2.6" height="7.2" rx="1.3"/></g></svg>`;

function noteIcon(note) {
  if (isEditorNote(note)) {
    return { word: "W", tinymce: "✍️", tiptap: "⚡", milkdown: "W", markdown: "MD", plain: "📝", native: "📄" }[note.type] || "📄";
  }
  return (note.url || "").includes("notepad.cc") ? CC_ICON : PW_ICON;
}

function renderNote(note) {
  const item = document.createElement("li");
  item.className = "note-item";

  const icon = document.createElement("span");
  icon.className = "note-item__icon";
  icon.innerHTML = noteIcon(note);

  const body = document.createElement("div");
  body.className = "note-item__body";
  body.setAttribute("role", "button");
  body.tabIndex = 0;

  const title = document.createElement("div");
  title.className = "note-item__title";
  title.textContent = note.title || "Untitled note";

  const meta = document.createElement("div");
  meta.className = "note-item__meta";
  meta.textContent = isEditorNote(note)
    ? `${EDITOR_LABELS[note.type] || "Editor"} note`
    : (note.url || "").replace(/^https?:\/\//, "");

  body.append(title, meta);
  body.addEventListener("click", () => openNote(note));
  body.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openNote(note);
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

  item.append(icon, body, del);
  return item;
}
