const STORAGE_KEY = "notepadHistory";
const NOTEPAD_BASE = "https://notepad.pw/";
const EDITOR_LABELS = {
  tinymce: "TinyMCE",
  ckeditor: "CKEditor",
  tiptap: "Tiptap",
  jck: "JCK",
  plain: "Plain Text",
  native: "Rich Text"
};

const newNoteButton = document.querySelector("#newNoteButton");
const clearAllButton = document.querySelector("#clearAllButton");
const noteList = document.querySelector("#noteList");
const emptyState = document.querySelector("#emptyState");
const listTitle = document.querySelector("#listTitle");
const openEditor = document.querySelector("#openEditor");
const editorModal = document.querySelector("#editorModal");

init();

async function init() {
  // Wire controls first so a rendering hiccup can never leave buttons dead.
  newNoteButton.addEventListener("click", () => { editorModal.hidden = false; });
  clearAllButton.addEventListener("click", clearAll);
  openEditor.addEventListener("click", (event) => {
    event.preventDefault();
    chrome.tabs.create({ url: chrome.runtime.getURL("src/popup.html") });
  });

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
    await createNotepadNote();
  } else {
    await createEditorNote(editor);
  }
}

async function createNotepadNote() {
  const slug = makeSlug();
  const url = `${NOTEPAD_BASE}${slug}`;
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
  await chrome.tabs.create({
    url: chrome.runtime.getURL(`src/note-editor.html?id=${encodeURIComponent(id)}`),
    active: true
  });
  await render();
}

function isEditorNote(note) {
  return Boolean(note.type) && note.type !== "notepad";
}

function openNote(note) {
  const url = isEditorNote(note)
    ? chrome.runtime.getURL(`src/note-editor.html?id=${encodeURIComponent(note.id)}`)
    : note.url;
  if (url) chrome.tabs.create({ url, active: true });
}

async function deleteNote(id) {
  const notes = await getNotes();
  await saveNotes(notes.filter((note) => note.id !== id));
  await render();
}

async function clearAll() {
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

function renderNote(note) {
  const item = document.createElement("li");
  item.className = "note-item";

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

  item.append(body, del);
  return item;
}
