(() => {
  const STORAGE_KEY = "notepadHistory";
  const COLLAPSE_KEY = "notepadSidebarCollapsed";
  const FOLDERS_KEY = "notepadFolders";
  const NOTEPAD_BASE = "https://notepad.pw/";
  const NOTEPADCC_BASE = "https://notepad.cc/";
  const HOST_ID = "page-studio-notepad-sidebar";
  const WIDTH_KEY = "notepadSidebarWidth";
  const DEFAULT_WIDTH = 280;
  const MIN_WIDTH = 220;
  const MAX_WIDTH = 520;
  let panelWidth = DEFAULT_WIDTH;
  const EDITOR_LABELS = {
    tinymce: "TinyMCE",
    tiptap: "Tiptap",
    plain: "Plain Text",
    native: "Rich Text"
  };

  // The notepad.pw logo (purple leaf), recreated as an inline SVG.
  const PW_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="18" height="18"><defs><linearGradient id="pwico" x1="0.15" y1="0.05" x2="0.9" y2="1"><stop offset="0" stop-color="#d24fd0"/><stop offset="0.55" stop-color="#a935bf"/><stop offset="1" stop-color="#7a1f9e"/></linearGradient><linearGradient id="pwfold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6a1a8f"/><stop offset="1" stop-color="#4e1170"/></linearGradient></defs><path d="M8 4C24 3 30 13 28 23 26.5 30 19 31 13 27.5 22 24 22 13 8 4Z" fill="url(#pwico)"/><path d="M13 27.5C8.5 25 7 18.5 9 13.5 13 17.5 15 23 13 27.5Z" fill="url(#pwfold)"/></svg>`;
  // notepad.cc favicon (spiral notepad with a blue bar).
  const CC_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="18" height="18"><rect x="5.5" y="7" width="21" height="21" rx="3.5" fill="#ffffff" stroke="#8b98a3" stroke-width="1.6"/><g stroke="#cbd4da" stroke-width="1.7" stroke-linecap="round"><line x1="9" y1="13" x2="23" y2="13"/><line x1="9" y1="17" x2="23" y2="17"/><line x1="9" y1="21" x2="19" y2="21"/></g><rect x="6.6" y="23.4" width="18.8" height="3.4" rx="1.7" fill="#3d9be0"/><g fill="#2b2f33"><rect x="9" y="3.4" width="2.6" height="7.2" rx="1.3"/><rect x="14.7" y="3.4" width="2.6" height="7.2" rx="1.3"/><rect x="20.4" y="3.4" width="2.6" height="7.2" rx="1.3"/></g></svg>`;

  // Only run once per page, and only in the top frame.
  if (window.top !== window || document.getElementById(HOST_ID)) {
    return;
  }

  let collapsed = false;
  let notes = [];
  let folders = [];
  let draggedRef = null;

  const host = document.createElement("div");
  host.id = HOST_ID;
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>${styles()}</style>
    <div class="wrap" data-collapsed="false">
      <button class="handle" type="button" title="Toggle notes sidebar" aria-label="Toggle notes sidebar">
        <span class="handle__icon">📝</span>
      </button>
      <aside class="panel">
        <header class="head">
          <div class="brand">
            <span class="logo">📝</span>
            <strong>Notes</strong>
          </div>
          <button class="collapse" type="button" title="Hide sidebar" aria-label="Hide sidebar">‹</button>
        </header>
        <button class="new-note" type="button">+ New Note</button>
        <div class="list-head">
          <span class="list-title">Recent notes</span>
          <div class="list-actions">
            <button class="new-folder" type="button" title="New folder">+ Folder</button>
            <button class="clear" type="button" hidden>Clear all</button>
          </div>
        </div>
        <ul class="items"></ul>
        <div class="empty" hidden>No notes saved yet.</div>
      </aside>
      <div class="resizer" title="Drag to resize"></div>

      <div class="modal" hidden>
        <div class="modal__backdrop" data-close></div>
        <div class="modal__card" role="dialog" aria-modal="true" aria-label="Choose editor">
          <div class="modal__head">
            <strong>New note</strong>
            <button class="modal__close" type="button" data-close aria-label="Close">×</button>
          </div>
          <p class="modal__sub">Where do you want to write?</p>
          <div class="modal__options">
            <button class="opt" type="button" data-editor="notepad"><span class="opt__icon">🌐</span><span class="opt__text"><span class="opt__title">notepad.pw</span><span class="opt__desc">Open a fresh online notepad page</span></span></button>
            <button class="opt" type="button" data-editor="notepadcc"><span class="opt__icon">🗒️</span><span class="opt__text"><span class="opt__title">notepad.cc</span><span class="opt__desc">Open a fresh notepad.cc page</span></span></button>
            <button class="opt" type="button" data-editor="tinymce"><span class="opt__icon">✍️</span><span class="opt__text"><span class="opt__title">TinyMCE</span><span class="opt__desc">Rich text editor with a toolbar</span></span></button>
            <button class="opt" type="button" data-editor="tiptap"><span class="opt__icon">⚡</span><span class="opt__text"><span class="opt__title">Tiptap</span><span class="opt__desc">Minimal keyboard-first editor</span></span></button>
            <button class="opt" type="button" data-editor="plain"><span class="opt__icon">📝</span><span class="opt__text"><span class="opt__title">Plain Text</span><span class="opt__desc">A simple distraction-free notepad</span></span></button>
          </div>
        </div>
      </div>
    </div>
  `;

  const wrap = shadow.querySelector(".wrap");
  const handle = shadow.querySelector(".handle");
  const collapseButton = shadow.querySelector(".collapse");
  const newNoteButton = shadow.querySelector(".new-note");
  const clearButton = shadow.querySelector(".clear");
  const items = shadow.querySelector(".items");
  const listTitle = shadow.querySelector(".list-title");
  const emptyState = shadow.querySelector(".empty");
  const resizer = shadow.querySelector(".resizer");

  const modal = shadow.querySelector(".modal");
  const newFolderButton = shadow.querySelector(".new-folder");

  handle.addEventListener("click", () => setCollapsed(false));
  collapseButton.addEventListener("click", () => setCollapsed(true));
  newNoteButton.addEventListener("click", () => { modal.hidden = false; });
  newFolderButton.addEventListener("click", createFolder);
  // Dropping onto the empty list area moves an item back to the root level.
  items.addEventListener("dragover", (event) => { event.preventDefault(); });
  items.addEventListener("drop", (event) => {
    event.preventDefault();
    dropOnTarget(null);
  });
  modal.addEventListener("click", (event) => {
    if (event.target.closest("[data-close]")) {
      modal.hidden = true;
      return;
    }
    const option = event.target.closest("[data-editor]");
    if (option) {
      modal.hidden = true;
      chooseEditor(option.dataset.editor, wantsNewTab(event));
    }
  });
  clearButton.addEventListener("click", clearAll);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !modal.hidden) {
      modal.hidden = true;
    }
  });
  resizer.addEventListener("mousedown", startResize);
  resizer.addEventListener("dblclick", () => setWidth(DEFAULT_WIDTH, true));

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes[STORAGE_KEY]) {
      notes = normalize(changes[STORAGE_KEY].newValue);
      renderList();
    }
    if (changes[FOLDERS_KEY]) {
      folders = normalize(changes[FOLDERS_KEY].newValue);
      renderList();
    }
    if (changes[COLLAPSE_KEY]) {
      applyCollapsed(Boolean(changes[COLLAPSE_KEY].newValue));
    }
    if (changes[WIDTH_KEY] && !dragging) {
      setWidth(Number(changes[WIDTH_KEY].newValue) || DEFAULT_WIDTH, false);
    }
  });

  boot();

  async function boot() {
    document.documentElement.appendChild(host);
    const data = await chrome.storage.local.get([STORAGE_KEY, FOLDERS_KEY, COLLAPSE_KEY, WIDTH_KEY]);
    notes = normalize(data[STORAGE_KEY]);
    folders = normalize(data[FOLDERS_KEY]);
    setWidth(clampWidth(Number(data[WIDTH_KEY]) || DEFAULT_WIDTH), false);
    applyCollapsed(Boolean(data[COLLAPSE_KEY]));
    await captureCurrentNote();
    renderList();
  }

  function saveFolders() {
    return chrome.storage.local.set({ [FOLDERS_KEY]: folders });
  }

  let dragging = false;

  function clampWidth(value) {
    return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(value)));
  }

  function setWidth(value, persist) {
    panelWidth = clampWidth(value);
    wrap.style.setProperty("--panel-w", `${panelWidth}px`);
    if (!collapsed) {
      document.documentElement.style.marginLeft = `${panelWidth}px`;
    }
    if (persist) {
      chrome.storage.local.set({ [WIDTH_KEY]: panelWidth });
    }
  }

  function startResize(event) {
    event.preventDefault();
    dragging = true;
    // Turn off the push transition so the page tracks the cursor smoothly.
    document.documentElement.style.transition = "none";
    wrap.classList.add("resizing");
    const onMove = (moveEvent) => setWidth(moveEvent.clientX, false);
    const onUp = () => {
      dragging = false;
      wrap.classList.remove("resizing");
      document.documentElement.style.transition = "margin-left 180ms ease";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      chrome.storage.local.set({ [WIDTH_KEY]: panelWidth });
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  // If the visitor landed on a notepad.pw note directly, keep the list complete.
  // Only notepad.pw pages self-register; editor notes are created elsewhere.
  async function captureCurrentNote() {
    const base = notepadBaseForHost();
    if (!base) return;
    const slug = currentSlug();
    if (!slug || notes.some((note) => note.id === slug)) {
      return;
    }
    notes.unshift({
      id: slug,
      type: "notepad",
      url: `${base}${slug}`,
      title: formatTitle(new Date()),
      createdAt: Date.now()
    });
    await save();
  }

  // The base URL for the online notepad the sidebar is currently on (if any).
  function notepadBaseForHost() {
    if (location.hostname === "notepad.pw") return NOTEPAD_BASE;
    if (location.hostname === "notepad.cc") return NOTEPADCC_BASE;
    return "";
  }

  // The id of the note shown on the current page, so it can be highlighted.
  function currentSlug() {
    if (notepadBaseForHost()) {
      const slug = decodeURIComponent(location.pathname.replace(/^\/+/, "").replace(/\/+$/, ""));
      return slug && !slug.includes("/") ? slug : "";
    }
    if (location.pathname.endsWith("/note-editor.html")) {
      return new URLSearchParams(location.search).get("id") || "";
    }
    return "";
  }

  function makeSlug() {
    const random = (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`)
      .replace(/-/g, "")
      .slice(0, 12);
    return `note-${random}`;
  }

  async function chooseEditor(editor, newTab) {
    if (editor === "notepad") {
      await createNote(NOTEPAD_BASE, newTab);
    } else if (editor === "notepadcc") {
      await createNote(NOTEPADCC_BASE, newTab);
    } else {
      await createEditorNote(editor);
    }
  }

  async function createNote(base, newTab) {
    const slug = makeSlug();
    const url = `${base}${slug}`;
    notes.unshift({
      id: slug,
      type: "notepad",
      url,
      title: formatTitle(new Date()),
      createdAt: Date.now()
    });
    await save();
    navigate(url, newTab);
  }

  async function createEditorNote(editor) {
    const id = makeSlug();
    const label = EDITOR_LABELS[editor] || "Note";
    notes.unshift({
      id,
      type: editor,
      title: `${label} note`,
      content: "",
      createdAt: Date.now()
    });
    await save();
    renderList();
    window.open(chrome.runtime.getURL(`src/note-editor.html?id=${encodeURIComponent(id)}`), "_blank", "noopener");
  }

  function navigate(url, newTab) {
    if (newTab) {
      window.open(url, "_blank", "noopener");
    } else {
      window.location.assign(url);
    }
  }

  function isEditorNote(note) {
    return Boolean(note.type) && note.type !== "notepad";
  }

  function noteUrl(note) {
    return isEditorNote(note)
      ? chrome.runtime.getURL(`src/note-editor.html?id=${encodeURIComponent(note.id)}`)
      : note.url;
  }

  // Notes open in the SAME tab by default. The only exception: a web page
  // (notepad.pw) cannot navigate in place to an extension page, so editor
  // notes fall back to a new tab there. On the extension's own note-editor
  // pages, everything (including editor notes) navigates in the same tab.
  function openNote(note, newTab) {
    const url = noteUrl(note);
    if (!url) return;
    const onExtensionPage = location.protocol === "chrome-extension:";
    if (newTab || (isEditorNote(note) && !onExtensionPage)) {
      window.open(url, "_blank", "noopener");
      return;
    }
    window.location.assign(url);
  }

  async function deleteNote(id) {
    notes = notes.filter((note) => note.id !== id);
    await save();
    renderList();
  }

  async function clearAll() {
    notes = [];
    await save();
    renderList();
  }

  function save() {
    return chrome.storage.local.set({ [STORAGE_KEY]: notes });
  }

  function setCollapsed(value) {
    applyCollapsed(value);
    chrome.storage.local.set({ [COLLAPSE_KEY]: value });
  }

  function applyCollapsed(value) {
    collapsed = value;
    wrap.dataset.collapsed = String(value);
    // Push the page content right so the sidebar occupies real layout space
    // instead of floating over the page.
    const root = document.documentElement;
    if (!dragging) {
      root.style.transition = "margin-left 180ms ease";
    }
    root.style.marginLeft = value ? "0px" : `${panelWidth}px`;
  }

  function wantsNewTab(event) {
    return Boolean(event.metaKey || event.ctrlKey);
  }

  function renderList() {
    items.innerHTML = "";
    const hasContent = notes.length > 0 || folders.length > 0;
    emptyState.hidden = hasContent;
    clearButton.hidden = notes.length === 0;
    listTitle.textContent = notes.length ? `Recent notes (${notes.length})` : "Recent notes";

    renderChildren(null, items);
  }

  // Renders subfolders then notes for a parent into the given container.
  // Nested folders get their own <ul> with a left "thread" rail (see CSS).
  function renderChildren(parentId, container) {
    const subFolders = folders
      .filter((folder) => (folder.parentId || null) === parentId)
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    for (const folder of subFolders) {
      renderFolder(folder, container);
    }

    const activeSlug = currentSlug();
    const childNotes = notes.filter((note) => (note.folderId || null) === parentId);
    for (const note of childNotes) {
      container.appendChild(renderItem(note, note.id === activeSlug));
    }
  }

  function renderFolder(folder, container) {
    const li = document.createElement("li");
    li.className = "folder";

    const head = document.createElement("div");
    head.className = "folder__head";
    head.draggable = true;

    const chevron = document.createElement("button");
    chevron.className = "folder__chevron";
    chevron.type = "button";
    chevron.textContent = folder.expanded === false ? "▸" : "▾";
    chevron.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleFolder(folder.id);
    });

    const icon = document.createElement("span");
    icon.className = "folder__icon";
    icon.textContent = "📁";

    const name = document.createElement("span");
    name.className = "folder__name";
    const count = countInFolder(folder.id);
    name.textContent = folder.name || "Folder";

    const badge = document.createElement("span");
    badge.className = "folder__count";
    badge.textContent = String(count);

    const rename = document.createElement("button");
    rename.className = "folder__edit";
    rename.type = "button";
    rename.title = "Rename folder";
    rename.textContent = "✎";
    rename.addEventListener("click", (event) => {
      event.stopPropagation();
      beginRenameFolder(head, name, folder);
    });

    const del = document.createElement("button");
    del.className = "folder__delete";
    del.type = "button";
    del.title = "Delete folder";
    del.textContent = "×";
    del.addEventListener("click", (event) => {
      event.stopPropagation();
      deleteFolder(folder.id);
    });

    head.append(chevron, icon, name, badge, rename, del);
    head.addEventListener("click", () => toggleFolder(folder.id));

    // Drag the folder itself, and accept drops of notes/folders into it.
    head.addEventListener("dragstart", (event) => {
      draggedRef = { kind: "folder", id: folder.id };
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", folder.id);
    });
    head.addEventListener("dragover", (event) => {
      event.preventDefault();
      head.classList.add("drop-hover");
    });
    head.addEventListener("dragleave", () => head.classList.remove("drop-hover"));
    head.addEventListener("drop", (event) => {
      event.preventDefault();
      event.stopPropagation();
      head.classList.remove("drop-hover");
      dropOnTarget(folder.id);
    });

    // Dropping anywhere in the folder's region (head or its children area)
    // moves the dragged item into this folder.
    li.addEventListener("dragover", (event) => event.preventDefault());
    li.addEventListener("drop", (event) => {
      event.preventDefault();
      event.stopPropagation();
      head.classList.remove("drop-hover");
      dropOnTarget(folder.id);
    });

    li.appendChild(head);
    container.appendChild(li);

    if (folder.expanded !== false) {
      const childrenList = document.createElement("ul");
      childrenList.className = "folder__children";
      // Empty folders still show a shallow rail so they read as containers.
      if (countInFolder(folder.id) === 0) {
        const emptyRow = document.createElement("li");
        emptyRow.className = "folder__empty";
        emptyRow.textContent = "Empty — drag notes here";
        childrenList.appendChild(emptyRow);
      }
      li.appendChild(childrenList);
      renderChildren(folder.id, childrenList);
    }
  }

  function countInFolder(folderId) {
    const noteCount = notes.filter((note) => (note.folderId || null) === folderId).length;
    const childFolders = folders.filter((folder) => (folder.parentId || null) === folderId);
    return noteCount + childFolders.reduce((sum, child) => sum + countInFolder(child.id), 0);
  }

  function renderItem(note, isActive) {
    const li = document.createElement("li");
    li.className = "item" + (isActive ? " item--active" : "");
    li.draggable = true;
    li.addEventListener("dragstart", (event) => {
      draggedRef = { kind: "note", id: note.id };
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", note.id);
    });

    const icon = document.createElement("span");
    icon.className = "item__icon";
    icon.innerHTML = noteIcon(note);

    const body = document.createElement("div");
    body.className = "item__body";
    body.setAttribute("role", "button");
    body.tabIndex = 0;

    const title = document.createElement("div");
    title.className = "item__title";
    title.textContent = note.title;

    const meta = document.createElement("div");
    meta.className = "item__meta";
    meta.textContent = isEditorNote(note)
      ? `${EDITOR_LABELS[note.type] || "Editor"} note`
      : (note.url || "").replace(/^https?:\/\//, "");

    body.append(title, meta);
    const open = (event) => openNote(note, wantsNewTab(event));
    body.addEventListener("click", open);
    body.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        open(event);
      }
    });

    const edit = document.createElement("button");
    edit.className = "item__edit";
    edit.type = "button";
    edit.title = "Rename note";
    edit.setAttribute("aria-label", "Rename note");
    edit.textContent = "✎";
    edit.addEventListener("click", (event) => {
      event.stopPropagation();
      beginRename(li, body, title, note);
    });

    const openNew = document.createElement("button");
    openNew.className = "item__newtab";
    openNew.type = "button";
    openNew.title = "Open in new tab";
    openNew.setAttribute("aria-label", "Open in new tab");
    openNew.textContent = "↗";
    openNew.addEventListener("click", (event) => {
      event.stopPropagation();
      openNote(note, true);
    });

    const del = document.createElement("button");
    del.className = "item__delete";
    del.type = "button";
    del.title = "Delete note";
    del.setAttribute("aria-label", "Delete note");
    del.textContent = "×";
    del.addEventListener("click", (event) => {
      event.stopPropagation();
      deleteNote(note.id);
    });

    li.append(icon, body, edit, openNew, del);
    return li;
  }

  // Per-type icon (HTML) shown against each note.
  function noteIcon(note) {
    if (isEditorNote(note)) {
      return { tinymce: "✍️", tiptap: "⚡", plain: "📝", native: "📄" }[note.type] || "📄";
    }
    return (note.url || "").includes("notepad.cc") ? CC_ICON : PW_ICON;
  }

  function beginRename(li, body, title, note) {
    if (li.querySelector(".item__rename")) return;
    const input = document.createElement("input");
    input.className = "item__rename";
    input.type = "text";
    input.value = note.title || "";
    input.placeholder = "Note title";

    body.replaceChild(input, title);
    input.focus();
    input.select();

    let done = false;
    const commit = async (persist) => {
      if (done) return;
      done = true;
      if (persist) {
        const value = input.value.trim();
        if (value) await renameNote(note.id, value);
      }
      renderList();
    };

    input.addEventListener("click", (event) => event.stopPropagation());
    input.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Enter") {
        event.preventDefault();
        commit(true);
      } else if (event.key === "Escape") {
        event.preventDefault();
        commit(false);
      }
    });
    input.addEventListener("blur", () => commit(true));
  }

  async function renameNote(id, title) {
    const index = notes.findIndex((note) => note.id === id);
    if (index === -1) return;
    notes[index] = { ...notes[index], title, updatedAt: Date.now() };
    await save();
  }

  // ---- Folders ----------------------------------------------------------

  async function createFolder() {
    const folder = {
      id: `folder-${makeSlug()}`,
      name: "New folder",
      parentId: null,
      expanded: true,
      createdAt: Date.now()
    };
    folders.unshift(folder);
    await saveFolders();
    renderList();
  }

  async function toggleFolder(id) {
    const index = folders.findIndex((folder) => folder.id === id);
    if (index === -1) return;
    folders[index] = { ...folders[index], expanded: folders[index].expanded === false };
    await saveFolders();
    renderList();
  }

  // Deleting a folder keeps its contents by moving them up to the parent.
  async function deleteFolder(id) {
    const target = folders.find((folder) => folder.id === id);
    if (!target) return;
    const newParent = target.parentId || null;

    folders = folders
      .filter((folder) => folder.id !== id)
      .map((folder) => (folder.parentId === id ? { ...folder, parentId: newParent } : folder));
    notes = notes.map((note) => (note.folderId === id ? { ...note, folderId: newParent } : note));

    await saveFolders();
    await save();
    renderList();
  }

  function beginRenameFolder(head, nameEl, folder) {
    if (head.querySelector(".folder__rename")) return;
    const input = document.createElement("input");
    input.className = "folder__rename";
    input.type = "text";
    input.value = folder.name || "";
    input.placeholder = "Folder name";

    head.replaceChild(input, nameEl);
    input.focus();
    input.select();

    let done = false;
    const commit = async (persist) => {
      if (done) return;
      done = true;
      if (persist) {
        const value = input.value.trim();
        if (value) await renameFolder(folder.id, value);
      }
      renderList();
    };

    input.addEventListener("click", (event) => event.stopPropagation());
    input.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Enter") {
        event.preventDefault();
        commit(true);
      } else if (event.key === "Escape") {
        event.preventDefault();
        commit(false);
      }
    });
    input.addEventListener("blur", () => commit(true));
  }

  async function renameFolder(id, name) {
    const index = folders.findIndex((folder) => folder.id === id);
    if (index === -1) return;
    folders[index] = { ...folders[index], name };
    await saveFolders();
  }

  // Move whatever is being dragged into the target folder (null = root).
  async function dropOnTarget(targetFolderId) {
    if (!draggedRef) return;
    const ref = draggedRef;
    draggedRef = null;

    if (ref.kind === "note") {
      const index = notes.findIndex((note) => note.id === ref.id);
      if (index !== -1) {
        notes[index] = { ...notes[index], folderId: targetFolderId };
        await save();
      }
    } else if (ref.kind === "folder") {
      if (ref.id === targetFolderId || isDescendantFolder(targetFolderId, ref.id)) {
        return; // can't drop a folder into itself or one of its descendants
      }
      const index = folders.findIndex((folder) => folder.id === ref.id);
      if (index !== -1) {
        folders[index] = { ...folders[index], parentId: targetFolderId };
        await saveFolders();
      }
    }
    renderList();
  }

  // Is `maybeDescendantId` inside the subtree of `ancestorId`?
  function isDescendantFolder(maybeDescendantId, ancestorId) {
    let current = folders.find((folder) => folder.id === maybeDescendantId);
    while (current && current.parentId) {
      if (current.parentId === ancestorId) return true;
      current = folders.find((folder) => folder.id === current.parentId);
    }
    return false;
  }

  function normalize(value) {
    return Array.isArray(value) ? value : [];
  }

  function formatTitle(date) {
    return date.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    });
  }

  function styles() {
    return `
      :host { all: initial; }
      * { box-sizing: border-box; }
      .wrap {
        --panel-w: 280px;
        position: fixed;
        top: 0;
        left: 0;
        height: 100vh;
        z-index: 2147483647;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        font-size: 14px;
        color: #192026;
      }
      .panel {
        position: absolute;
        top: 0;
        left: 0;
        width: var(--panel-w);
        height: 100%;
        background: #f6f7f9;
        border-right: 1px solid #e2e7eb;
        box-shadow: 8px 0 24px rgba(25, 32, 38, 0.12);
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 14px;
        transition: transform 180ms ease;
      }
      .wrap[data-collapsed="true"] .panel { transform: translateX(-100%); }
      .resizer {
        position: absolute;
        top: 0;
        left: calc(var(--panel-w) - 3px);
        width: 6px;
        height: 100%;
        cursor: col-resize;
        background: transparent;
        transition: background 120ms ease;
      }
      .resizer:hover,
      .wrap.resizing .resizer { background: rgba(13, 146, 118, 0.35); }
      .wrap[data-collapsed="true"] .resizer { display: none; }
      .wrap.resizing { user-select: none; }
      .handle {
        position: absolute;
        top: 50%;
        left: var(--panel-w);
        transform: translateY(-50%);
        width: 34px;
        height: 52px;
        border: 1px solid #e2e7eb;
        border-left: 0;
        border-radius: 0 10px 10px 0;
        background: #ffffff;
        box-shadow: 4px 0 14px rgba(25, 32, 38, 0.12);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 18px;
        opacity: 0;
        pointer-events: none;
        transition: left 180ms ease, opacity 120ms ease;
      }
      .wrap[data-collapsed="true"] .handle {
        left: 0;
        opacity: 1;
        pointer-events: auto;
      }
      .head { display: flex; align-items: center; justify-content: space-between; }
      .brand { display: flex; align-items: center; gap: 8px; }
      .brand strong { font-size: 16px; }
      .logo {
        display: inline-flex; align-items: center; justify-content: center;
        width: 28px; height: 28px; background: #ffffff;
        border: 1px solid #e2e7eb; border-radius: 8px; font-size: 15px;
      }
      .collapse {
        border: 0; background: #e8edf0; color: #24313a; cursor: pointer;
        width: 28px; height: 28px; border-radius: 8px; font-size: 18px; line-height: 1;
      }
      .collapse:hover { background: #dce4e8; }
      .new-note {
        border: 0; border-radius: 10px; background: #0d9276; color: #fff;
        font-weight: 800; min-height: 42px; cursor: pointer;
        box-shadow: 0 8px 18px rgba(13, 146, 118, 0.22);
      }
      .new-note:hover { background: #087c65; }
      .new-note:active { transform: translateY(1px); }
      .list-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
      .list-title { font-size: 12px; font-weight: 700; color: #303941; }
      .list-actions { display: flex; align-items: baseline; gap: 12px; }
      .new-folder {
        border: 0; background: none; color: #0d9276; font-weight: 700;
        font-size: 12px; cursor: pointer; padding: 0;
      }
      .new-folder:hover { text-decoration: underline; }
      .clear {
        border: 0; background: none; color: #0d9276; font-weight: 700;
        font-size: 12px; cursor: pointer; padding: 0;
      }
      .clear:hover { text-decoration: underline; }
      .items {
        list-style: none; margin: 0; padding: 0;
        display: flex; flex-direction: column; gap: 6px;
        overflow-y: auto; flex: 1;
      }
      .folder { list-style: none; }
      .folder__head {
        display: flex; align-items: center; gap: 6px;
        background: #eef2f4; border: 1px solid #e2e7eb; border-radius: 9px;
        padding: 7px 8px; cursor: pointer;
      }
      .folder__head:hover { background: #e6ecef; }
      .folder__head.drop-hover { border-color: #0d9276; background: #e4f4ef; box-shadow: 0 0 0 2px rgba(13, 146, 118, 0.22); }
      .folder__chevron {
        border: 0; background: none; cursor: pointer; padding: 0;
        color: #5f6b74; font-size: 11px; width: 14px; flex-shrink: 0;
      }
      .folder__icon { font-size: 14px; line-height: 1; flex-shrink: 0; }
      .folder__name {
        flex: 1; min-width: 0; font-size: 13px; font-weight: 800; color: #2a343b;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .folder__count {
        flex-shrink: 0; background: #d7e0e4; color: #566169; border-radius: 999px;
        font-size: 10px; font-weight: 700; padding: 1px 7px;
      }
      .folder__edit, .folder__delete {
        flex-shrink: 0; width: 22px; height: 22px; border: 0; border-radius: 6px;
        background: transparent; color: #6b7580; font-size: 13px; line-height: 1; cursor: pointer;
        opacity: 0; transition: opacity 120ms ease;
      }
      .folder__head:hover .folder__edit, .folder__head:hover .folder__delete { opacity: 1; }
      .folder__edit:hover { background: #d9ece4; color: #0d9276; }
      .folder__delete:hover { background: #fbe4e4; color: #c0392b; }
      .folder__rename {
        flex: 1; min-width: 0; width: 100%;
        border: 1px solid #0d9276; border-radius: 6px;
        font-size: 13px; font-weight: 800; color: #151b20;
        padding: 4px 7px; outline: 0;
        box-shadow: 0 0 0 3px rgba(13, 146, 118, 0.14);
      }
      /* Threaded view: children nest under their folder with a connector rail. */
      .folder__children {
        list-style: none; margin: 6px 0 0 0; padding: 0 0 0 18px;
        display: flex; flex-direction: column; gap: 6px;
        position: relative;
      }
      .folder__children::before {
        content: ""; position: absolute; left: 8px; top: -4px; bottom: 10px;
        width: 2px; border-radius: 2px; background: #d3dbe0;
      }
      .folder__children > li { position: relative; }
      .folder__children > li::before {
        content: ""; position: absolute; left: -10px; top: 17px;
        width: 10px; height: 2px; border-radius: 2px; background: #d3dbe0;
      }
      .folder__empty {
        font-size: 11px; font-style: italic; color: #9aa4ab;
        padding: 3px 2px;
      }
      .item {
        display: flex; align-items: center; gap: 8px;
        background: #ffffff; border: 1px solid #e2e7eb; border-radius: 10px;
        padding: 9px 10px;
      }
      .item__icon {
        flex-shrink: 0; width: 22px; height: 22px;
        display: flex; align-items: center; justify-content: center;
        font-size: 15px; line-height: 1;
      }
      .item:hover { border-color: #cfd6db; }
      .item--active { border-color: #0d9276; box-shadow: 0 0 0 2px rgba(13, 146, 118, 0.16); }
      .item__body { flex: 1; min-width: 0; cursor: pointer; }
      .item__title {
        font-size: 13px; font-weight: 700; color: #151b20;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .item__meta {
        font-size: 11px; color: #7a848c; margin-top: 2px;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .item__edit,
      .item__newtab,
      .item__delete {
        flex-shrink: 0; width: 26px; height: 26px; border: 0; border-radius: 7px;
        background: #f1f4f6; color: #6b7580; font-size: 15px; line-height: 1; cursor: pointer;
        opacity: 0; transition: opacity 120ms ease;
      }
      /* Reveal the action icons only when hovering or keyboard-focusing a row. */
      .item:hover .item__edit,
      .item:hover .item__newtab,
      .item:hover .item__delete,
      .item:focus-within .item__edit,
      .item:focus-within .item__newtab,
      .item:focus-within .item__delete {
        opacity: 1;
      }
      .item__newtab { font-weight: 700; }
      .item__edit { font-size: 14px; }
      .item__edit:hover { background: #e4f1ec; color: #0d9276; }
      .item__newtab:hover { background: #e4f1ec; color: #0d9276; }
      .item__delete:hover { background: #fbe4e4; color: #c0392b; }
      .item__rename {
        flex: 1; min-width: 0; width: 100%;
        border: 1px solid #0d9276; border-radius: 6px;
        font-size: 13px; font-weight: 700; color: #151b20;
        padding: 5px 7px; outline: 0;
        box-shadow: 0 0 0 3px rgba(13, 146, 118, 0.14);
      }
      .empty {
        background: #ffffff; border: 1px dashed #d7dde2; border-radius: 10px;
        padding: 18px 12px; text-align: center; color: #5f6b74; font-size: 12px;
      }
      .modal[hidden] { display: none; }
      .modal {
        position: fixed; inset: 0; display: grid; place-items: center;
        z-index: 2147483647; padding: 16px;
      }
      .modal__backdrop { position: absolute; inset: 0; background: rgba(15, 22, 27, 0.45); }
      .modal__card {
        position: relative; background: #ffffff; border-radius: 14px;
        box-shadow: 0 24px 60px rgba(15, 22, 27, 0.28);
        display: grid; gap: 10px; padding: 18px; width: min(340px, 90vw);
      }
      .modal__head { display: flex; align-items: center; justify-content: space-between; }
      .modal__head strong { font-size: 17px; }
      .modal__close {
        background: #f1f4f6; border: 0; border-radius: 8px; color: #5f6b74;
        cursor: pointer; font-size: 20px; height: 30px; width: 30px; line-height: 1; padding: 0;
      }
      .modal__close:hover { background: #e6ebee; }
      .modal__sub { color: #5f6b74; font-size: 13px; margin: 0; }
      .modal__options { display: grid; gap: 8px; margin-top: 4px; }
      .opt {
        display: flex; align-items: center; gap: 12px; text-align: left;
        background: #f7f9fa; border: 1px solid #e2e7eb; border-radius: 10px;
        cursor: pointer; padding: 11px 13px;
        transition: border-color 120ms ease, background 120ms ease;
      }
      .opt:hover { background: #eef7f4; border-color: #0d9276; }
      .opt__icon { font-size: 20px; line-height: 1; }
      .opt__text { display: grid; gap: 2px; }
      .opt__title { color: #151b20; font-size: 14px; font-weight: 800; }
      .opt__desc { color: #7a848c; font-size: 12px; }
    `;
  }
})();
