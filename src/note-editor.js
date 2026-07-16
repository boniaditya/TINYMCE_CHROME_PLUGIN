const STORAGE_KEY = "notepadHistory";

const EDITOR_LABELS = {
  tinymce: "TinyMCE",
  ckeditor: "CKEditor",
  tiptap: "Tiptap",
  jck: "JCK",
  plain: "Plain Text",
  native: "Rich Text"
};

const noteTitle = document.querySelector("#noteTitle");
const editorBadge = document.querySelector("#editorBadge");
const saveState = document.querySelector("#saveState");
const richEditor = document.querySelector("#richEditor");
const plainEditor = document.querySelector("#plainEditor");
const editorError = document.querySelector("#editorError");

const state = {
  id: null,
  type: "native",
  instance: null,
  getContent: () => richEditor.innerHTML,
  saveTimer: 0
};

init();

async function init() {
  state.id = new URLSearchParams(location.search).get("id");
  if (!state.id) {
    showError("This note is missing an id.");
    return;
  }

  const record = await getRecord();
  if (!record) {
    showError("This note could not be found. It may have been deleted.");
    return;
  }

  state.type = record.type || "native";
  editorBadge.textContent = EDITOR_LABELS[state.type] || "Note";
  document.title = `${record.title || "Note"} — ${editorBadge.textContent}`;
  noteTitle.value = record.title || "";

  noteTitle.addEventListener("input", scheduleSave);
  window.addEventListener("beforeunload", () => saveNow());

  try {
    await startEditor(record.content || "");
  } catch (error) {
    showError(`Could not load the ${editorBadge.textContent} editor. Writing in plain rich-text instead.`);
    state.type = "native";
    richEditor.innerHTML = record.content || "";
    richEditor.addEventListener("input", scheduleSave);
  }
}

async function startEditor(content) {
  if (state.type === "plain") {
    return startPlain(content);
  }
  if (state.type === "tinymce") {
    return startTinyMce(content);
  }
  // JCK is a CKEditor distribution, so it runs on the vendored CKEditor engine.
  if (state.type === "ckeditor" || state.type === "jck") {
    return startCkEditor(content);
  }
  if (state.type === "tiptap") {
    return startTiptap(content);
  }
  return startNative(content);
}

function startNative(content) {
  richEditor.innerHTML = content;
  richEditor.addEventListener("input", scheduleSave);
  state.getContent = () => richEditor.innerHTML;
  richEditor.focus();
}

function startPlain(content) {
  richEditor.hidden = true;
  plainEditor.hidden = false;
  plainEditor.value = content;
  plainEditor.addEventListener("input", scheduleSave);
  state.getContent = () => plainEditor.value;
  plainEditor.focus();
}

async function startTinyMce(content) {
  await loadScript(assetUrl("vendor/tinymce/tinymce.min.js"));
  if (!window.tinymce) throw new Error("tinymce-unavailable");

  const [editor] = await window.tinymce.init({
    target: richEditor,
    inline: true,
    menubar: false,
    branding: false,
    promotion: false,
    license_key: "gpl",
    base_url: assetUrl("vendor/tinymce"),
    suffix: ".min",
    plugins: "lists link image table code",
    toolbar: "undo redo | blocks | bold italic underline | alignleft aligncenter alignright | bullist numlist | link image table | code",
    setup(ed) {
      ed.on("init", () => ed.setContent(content));
      ed.on("input change keyup undo redo", scheduleSave);
    }
  });

  state.instance = editor;
  state.getContent = () => editor.getContent();
}

async function startCkEditor(content) {
  await loadScript(assetUrl("vendor/ckeditor/ckeditor.js"));
  if (!window.CKEDITOR?.replace) throw new Error("ckeditor-unavailable");

  // Use replace + divarea (persistent top toolbar) rather than inline mode:
  // the inline floating toolbar doesn't render reliably on the extension page,
  // which left formatting buttons unavailable.
  richEditor.hidden = true;
  plainEditor.hidden = false;
  plainEditor.value = content;

  const editor = window.CKEDITOR.replace(plainEditor, {
    versionCheck: false,
    allowedContent: true,
    extraAllowedContent: "*(*);*{*}",
    extraPlugins: "divarea",
    removePlugins: "elementspath,exportpdf",
    height: Math.max(360, window.innerHeight - 220),
    toolbar: [
      { name: "clipboard", items: ["Undo", "Redo"] },
      { name: "styles", items: ["Format", "Font", "FontSize"] },
      { name: "basicstyles", items: ["Bold", "Italic", "Underline", "Strike", "RemoveFormat"] },
      { name: "paragraph", items: ["NumberedList", "BulletedList", "Blockquote"] },
      { name: "links", items: ["Link", "Unlink"] },
      { name: "insert", items: ["Image", "Table", "HorizontalRule"] }
    ]
  });

  state.instance = editor;
  state.getContent = () => editor.getData();
  editor.on("change", scheduleSave);
}

async function startTiptap(content) {
  await loadScript(assetUrl("vendor/tiptap/tiptap.umd.js"));
  if (!window.PageStudioTiptap?.create) throw new Error("tiptap-unavailable");

  richEditor.removeAttribute("contenteditable");
  richEditor.innerHTML = content;
  const editor = window.PageStudioTiptap.create(richEditor);
  state.instance = editor;
  state.getContent = () => (typeof editor.getHTML === "function" ? editor.getHTML() : richEditor.innerHTML);

  if (editor?.on) {
    editor.on("update", scheduleSave);
  } else {
    richEditor.addEventListener("input", scheduleSave);
  }
}

function scheduleSave() {
  saveState.textContent = "Saving…";
  window.clearTimeout(state.saveTimer);
  state.saveTimer = window.setTimeout(saveNow, 400);
}

async function saveNow() {
  window.clearTimeout(state.saveTimer);
  const notes = await getNotes();
  const index = notes.findIndex((note) => note.id === state.id);
  if (index === -1) return;

  notes[index] = {
    ...notes[index],
    title: noteTitle.value.trim() || notes[index].title,
    content: safeGetContent(),
    updatedAt: Date.now()
  };
  await chrome.storage.local.set({ [STORAGE_KEY]: notes });
  saveState.textContent = "Saved";
}

function safeGetContent() {
  try {
    return state.getContent();
  } catch {
    return richEditor.innerHTML;
  }
}

async function getNotes() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  return Array.isArray(data[STORAGE_KEY]) ? data[STORAGE_KEY] : [];
}

async function getRecord() {
  const notes = await getNotes();
  return notes.find((note) => note.id === state.id) || null;
}

function assetUrl(path) {
  return chrome.runtime.getURL(path);
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = false;
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener("error", () => reject(new Error(`failed to load ${src}`)), { once: true });
    document.head.appendChild(script);
  });
}

function showError(message) {
  editorError.textContent = message;
  editorError.hidden = false;
}
