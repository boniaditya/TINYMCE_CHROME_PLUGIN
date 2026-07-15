const STORAGE_KEY = "notepadHistory";
const NOTEPAD_BASE = "https://notepad.pw/";

const newNoteButton = document.querySelector("#newNoteButton");
const clearAllButton = document.querySelector("#clearAllButton");
const noteList = document.querySelector("#noteList");
const emptyState = document.querySelector("#emptyState");
const listTitle = document.querySelector("#listTitle");
const openEditor = document.querySelector("#openEditor");

init();

async function init() {
  await render();
  newNoteButton.addEventListener("click", createNote);
  clearAllButton.addEventListener("click", clearAll);
  openEditor.addEventListener("click", (event) => {
    event.preventDefault();
    chrome.tabs.create({ url: chrome.runtime.getURL("src/popup.html") });
  });
}

// A random, hard-to-collide slug so we open a fresh, private pad every time.
function makeSlug() {
  const random = (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`)
    .replace(/-/g, "")
    .slice(0, 12);
  return `note-${random}`;
}

async function getNotes() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  const notes = data[STORAGE_KEY];
  return Array.isArray(notes) ? notes : [];
}

async function saveNotes(notes) {
  await chrome.storage.local.set({ [STORAGE_KEY]: notes });
}

async function createNote() {
  newNoteButton.disabled = true;
  const slug = makeSlug();
  const url = `${NOTEPAD_BASE}${slug}`;
  const note = {
    id: slug,
    url,
    title: formatTitle(new Date()),
    createdAt: Date.now()
  };

  const notes = await getNotes();
  notes.unshift(note);
  await saveNotes(notes);

  await chrome.tabs.create({ url, active: true });
  await render();
  newNoteButton.disabled = false;
}

async function openNote(url) {
  await chrome.tabs.create({ url, active: true });
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

function shortUrl(url) {
  return url.replace(/^https?:\/\//, "");
}

async function render() {
  const notes = await getNotes();
  noteList.innerHTML = "";

  const hasNotes = notes.length > 0;
  emptyState.hidden = hasNotes;
  clearAllButton.hidden = !hasNotes;
  listTitle.textContent = hasNotes
    ? `Recent notes (${notes.length})`
    : "Recent notes";

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
  title.textContent = note.title;

  const meta = document.createElement("div");
  meta.className = "note-item__meta";
  meta.textContent = shortUrl(note.url);

  body.append(title, meta);
  body.addEventListener("click", () => openNote(note.url));
  body.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openNote(note.url);
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
