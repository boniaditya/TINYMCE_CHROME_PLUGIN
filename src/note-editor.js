const STORAGE_KEY = "notepadHistory";

const EDITOR_LABELS = {
  ckeditor: "CKEditor",
  tinymce: "TinyMCE",
  tiptap: "Tiptap",
  milkdown: "Milkdown",
  markdown: "Markdown",
  plain: "Plain Text",
  native: "Rich Text"
};

const noteTitle = document.querySelector("#noteTitle");
const editorBadge = document.querySelector("#editorBadge");
const saveState = document.querySelector("#saveState");
const editorHost = document.querySelector("#editorHost");
const toolbarHost = document.querySelector("#toolbarHost");
const richEditor = document.querySelector("#richEditor");
const plainEditor = document.querySelector("#plainEditor");
const milkdownEditor = document.querySelector("#milkdownEditor");
const markdownEditor = document.querySelector("#markdownEditor");
const markdownSource = document.querySelector("#markdownSource");
const markdownPreview = document.querySelector("#markdownPreview");
const editorError = document.querySelector("#editorError");
const loremButton = document.querySelector("#loremButton");
const exportButton = document.querySelector("#exportButton");
const exportMenu = document.querySelector("#exportMenu");
const settingsButton = document.querySelector("#settingsButton");

const state = {
  id: null,
  type: "native",
  record: null,
  instance: null,
  getContent: () => richEditor.innerHTML,
  loremHistory: new Set(),
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

  state.record = record;
  state.type = record.type || "native";
  editorBadge.textContent = EDITOR_LABELS[state.type] || "Note";
  document.title = `${record.title || "Note"} — ${editorBadge.textContent}`;
  noteTitle.value = record.title || "";

  noteTitle.addEventListener("input", scheduleSave);
  settingsButton.addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("src/settings.html"), active: true }));
  installLoremControls();
  installExportControls();
  window.addEventListener("beforeunload", () => saveNow());

  try {
    await startEditor(record.content || "");
  } catch (error) {
    showError(`Could not load the ${editorBadge.textContent} editor. Writing in plain rich-text instead.`);
    state.type = "native";
    hideToolbar();
    setEditorMode("native");
    richEditor.hidden = false;
    plainEditor.hidden = true;
    milkdownEditor.hidden = true;
    markdownEditor.hidden = true;
    richEditor.innerHTML = record.content || "";
    richEditor.addEventListener("input", scheduleSave);
  }
}

async function startEditor(content) {
  if (state.type === "plain") {
    return startPlain(content);
  }
  if (state.type === "markdown") {
    return startMarkdown(content);
  }
  if (state.type === "milkdown") {
    return startMilkdown(content);
  }
  if (state.type === "tinymce") {
    return startTinyMce(content);
  }
  if (state.type === "ckeditor") {
    return startCkEditor(content);
  }
  if (state.type === "tiptap") {
    return startTiptap(content);
  }
  return startNative(content);
}

function startNative(content) {
  setEditorMode("native");
  richEditor.hidden = false;
  plainEditor.hidden = true;
  milkdownEditor.hidden = true;
  markdownEditor.hidden = true;
  richEditor.innerHTML = content;
  richEditor.addEventListener("input", scheduleSave);
  state.getContent = () => richEditor.innerHTML;
  richEditor.focus();
}

function startPlain(content) {
  setEditorMode("plain");
  richEditor.hidden = true;
  plainEditor.hidden = false;
  milkdownEditor.hidden = true;
  markdownEditor.hidden = true;
  plainEditor.value = content;
  plainEditor.addEventListener("input", scheduleSave);
  state.getContent = () => plainEditor.value;
  plainEditor.focus();
}

async function startTinyMce(content) {
  setEditorMode("tinymce");
  richEditor.hidden = false;
  plainEditor.hidden = true;
  milkdownEditor.hidden = true;
  markdownEditor.hidden = true;
  await loadScript(assetUrl("vendor/tinymce/tinymce.min.js"));
  if (!window.tinymce) throw new Error("tinymce-unavailable");

  showToolbar();
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
    fixed_toolbar_container: "#toolbarHost",
    toolbar_persist: true,
    toolbar_mode: "wrap",
    toolbar: "undo redo | blocks | bold italic underline | alignleft aligncenter alignright | bullist numlist | link image table | code",
    setup(ed) {
      ed.on("init", () => {
        ed.setContent(content);
        window.requestAnimationFrame(() => {
          ed.focus();
          ed.selection.select(ed.getBody(), true);
          ed.selection.collapse(false);
        });
      });
      ed.on("input change keyup undo redo", scheduleSave);
    }
  });

  state.instance = editor;
  state.getContent = () => editor.getContent();
}

async function startCkEditor(content) {
  const ckeditor = window.CKEDITOR;
  if (!ckeditor?.ClassicEditor) throw new Error("ckeditor-unavailable");

  setEditorMode("ckeditor");
  richEditor.hidden = false;
  plainEditor.hidden = true;
  milkdownEditor.hidden = true;
  markdownEditor.hidden = true;
  richEditor.removeAttribute("contenteditable");
  richEditor.innerHTML = content;

  const editor = await ckeditor.ClassicEditor.create(richEditor, {
    licenseKey: "GPL",
    plugins: [
      ckeditor.Essentials,
      ckeditor.Paragraph,
      ckeditor.Heading,
      ckeditor.Bold,
      ckeditor.Italic,
      ckeditor.Underline,
      ckeditor.Strikethrough,
      ckeditor.Link,
      ckeditor.List,
      ckeditor.BlockQuote,
      ckeditor.CodeBlock,
      ckeditor.Table,
      ckeditor.TableToolbar
    ],
    toolbar: {
      items: [
        "undo", "redo", "|",
        "heading", "|",
        "bold", "italic", "underline", "strikethrough", "link", "|",
        "bulletedList", "numberedList", "blockQuote", "codeBlock", "|",
        "insertTable"
      ],
      shouldNotGroupWhenFull: false
    },
    table: {
      contentToolbar: ["tableColumn", "tableRow", "mergeTableCells"]
    },
    placeholder: "Start writing…"
  });

  state.instance = editor;
  state.getContent = () => editor.getData();
  editor.model.document.on("change:data", scheduleSave);
  editor.editing.view.focus();
}

async function startTiptap(content) {
  setEditorMode("tiptap");
  richEditor.hidden = false;
  plainEditor.hidden = true;
  milkdownEditor.hidden = true;
  markdownEditor.hidden = true;
  await loadScript(assetUrl("vendor/tiptap/tiptap.umd.js"));
  if (!window.PageStudioTiptap?.create) throw new Error("tiptap-unavailable");

  richEditor.removeAttribute("contenteditable");
  richEditor.innerHTML = content;
  const editor = window.PageStudioTiptap.create(richEditor);
  showTiptapToolbar(editor);
  state.instance = editor;
  state.getContent = () => (typeof editor.getHTML === "function" ? editor.getHTML() : richEditor.innerHTML);

  if (editor?.on) {
    editor.on("update", scheduleSave);
  } else {
    richEditor.addEventListener("input", scheduleSave);
  }
}

function startMarkdown(content) {
  setEditorMode("markdown");
  richEditor.hidden = true;
  plainEditor.hidden = true;
  milkdownEditor.hidden = true;
  markdownEditor.hidden = false;
  markdownSource.value = content;
  markdownSource.addEventListener("input", () => {
    renderMarkdownPreview();
    scheduleSave();
  });
  showMarkdownToolbar();
  renderMarkdownPreview();
  state.getContent = () => markdownSource.value;
  markdownSource.focus();
}

async function startMilkdown(content) {
  setEditorMode("milkdown");
  richEditor.hidden = true;
  plainEditor.hidden = true;
  markdownEditor.hidden = true;
  milkdownEditor.hidden = false;
  hideToolbar();

  await loadStylesheet(assetUrl("vendor/milkdown/milkdown.css"));
  defineVueFeatureFlags();
  await loadScript(assetUrl("vendor/milkdown/milkdown.js"));
  if (!window.NotepadLibraryMilkdown?.create) throw new Error("milkdown-unavailable");

  const editor = window.NotepadLibraryMilkdown.create(milkdownEditor, content, scheduleSave);
  state.instance = editor;
  state.getContent = () => editor.getMarkdown();
  await editor.ready;
  editor.focus();
}

function setEditorMode(editor) {
  editorHost.dataset.editor = editor;
  document.body.dataset.editor = editor;
}

function defineVueFeatureFlags() {
  globalThis.__VUE_OPTIONS_API__ = true;
  globalThis.__VUE_PROD_DEVTOOLS__ = false;
  globalThis.__VUE_PROD_HYDRATION_MISMATCH_DETAILS__ = false;
}

function showToolbar(markup = "") {
  toolbarHost.hidden = false;
  toolbarHost.innerHTML = markup;
}

function hideToolbar() {
  toolbarHost.hidden = true;
  toolbarHost.innerHTML = "";
}

function showTiptapToolbar(editor) {
  showToolbar(`
    <div class="note-toolbar" role="toolbar" aria-label="Tiptap formatting toolbar">
      <select class="note-toolbar__select" data-command="formatBlock" aria-label="Block style">
        <option value="p">Paragraph</option>
        <option value="h1">Heading 1</option>
        <option value="h2">Heading 2</option>
        <option value="h3">Heading 3</option>
      </select>
      <span class="note-toolbar__group">
        ${toolbarButton("B", "Bold", "bold")}
        ${toolbarButton("I", "Italic", "italic")}
        ${toolbarButton("U", "Underline", "underline")}
      </span>
      <span class="note-toolbar__group">
        ${toolbarButton("•", "Bullet list", "insertUnorderedList")}
        ${toolbarButton("1.", "Numbered list", "insertOrderedList")}
      </span>
      <span class="note-toolbar__group">
        ${toolbarButton("Link", "Insert link", "createLink")}
        ${toolbarButton("Image", "Insert image", "insertImage")}
        ${toolbarButton("Clear", "Clear formatting", "removeFormat")}
      </span>
    </div>
  `);

  toolbarHost.querySelectorAll("button").forEach((button) => {
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", () => {
      const command = button.dataset.command;
      if (command === "createLink") {
        const href = window.prompt("Link URL");
        if (href !== null) editor.runCommand(command, href.trim());
        return;
      }
      if (command === "insertImage") {
        const src = window.prompt("Image URL");
        if (src) editor.runCommand(command, src.trim());
        return;
      }
      editor.runCommand(command);
    });
  });

  toolbarHost.querySelector("[data-command='formatBlock']").addEventListener("change", (event) => {
    editor.runCommand("formatBlock", event.target.value);
  });
}

function showMarkdownToolbar() {
  showToolbar(`
    <div class="note-toolbar" role="toolbar" aria-label="Markdown toolbar">
      <span class="note-toolbar__group">
        ${toolbarButton("H1", "Heading 1", "heading-1")}
        ${toolbarButton("H2", "Heading 2", "heading-2")}
        ${toolbarButton("B", "Bold", "bold")}
        ${toolbarButton("I", "Italic", "italic")}
        ${toolbarButton("Code", "Inline code", "code")}
      </span>
      <span class="note-toolbar__group">
        ${toolbarButton("•", "Bullet list", "bullet")}
        ${toolbarButton("1.", "Numbered list", "numbered")}
        ${toolbarButton("[ ]", "Task item", "task")}
        ${toolbarButton(">", "Quote", "quote")}
      </span>
      <span class="note-toolbar__group">
        ${toolbarButton("Link", "Insert link", "link")}
        ${toolbarButton("Image", "Insert image", "image")}
        ${toolbarButton("Table", "Insert table", "table")}
      </span>
      <span class="note-toolbar__group note-toolbar__group--right">
        ${modeButton("source", "Source")}
        ${modeButton("split", "Split")}
        ${modeButton("preview", "Preview")}
      </span>
    </div>
  `);

  toolbarHost.querySelectorAll("[data-md-command]").forEach((button) => {
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", () => applyMarkdownCommand(button.dataset.mdCommand));
  });
  toolbarHost.querySelectorAll("[data-md-mode]").forEach((button) => {
    button.addEventListener("click", () => setMarkdownMode(button.dataset.mdMode));
  });
  setMarkdownMode("split");
}

function toolbarButton(label, title, command) {
  return `<button class="note-toolbar__button" type="button" title="${title}" data-command="${command}" data-md-command="${command}">${label}</button>`;
}

function modeButton(mode, label) {
  return `<button class="note-toolbar__button" type="button" data-md-mode="${mode}">${label}</button>`;
}

function applyMarkdownCommand(command) {
  if (command === "heading-1") return prefixMarkdownLine("# ", "Heading");
  if (command === "heading-2") return prefixMarkdownLine("## ", "Heading");
  if (command === "bold") return wrapMarkdownSelection("**", "**", "bold text");
  if (command === "italic") return wrapMarkdownSelection("_", "_", "italic text");
  if (command === "code") return wrapMarkdownSelection("`", "`", "code");
  if (command === "bullet") return prefixMarkdownLine("- ", "List item");
  if (command === "numbered") return prefixMarkdownLine("1. ", "List item");
  if (command === "task") return prefixMarkdownLine("- [ ] ", "Task item");
  if (command === "quote") return prefixMarkdownLine("> ", "Quote");
  if (command === "link") return wrapMarkdownSelection("[", "](https://example.com)", "link text");
  if (command === "image") return insertMarkdown("![Alt text](https://example.com/image.png)");
  if (command === "table") {
    return insertMarkdown("| Column | Column |\n| --- | --- |\n| Value | Value |");
  }
}

function wrapMarkdownSelection(before, after, placeholder) {
  const { selectionStart, selectionEnd, value } = markdownSource;
  const selected = value.slice(selectionStart, selectionEnd) || placeholder;
  const next = `${before}${selected}${after}`;
  replaceMarkdownRange(selectionStart, selectionEnd, next, before.length, selected.length);
}

function prefixMarkdownLine(prefix, placeholder) {
  const value = markdownSource.value;
  const start = markdownSource.selectionStart;
  const end = markdownSource.selectionEnd;
  const lineStart = value.lastIndexOf("\n", start - 1) + 1;
  const lineEnd = value.indexOf("\n", end);
  const rangeEnd = lineEnd === -1 ? value.length : lineEnd;
  const selected = value.slice(lineStart, rangeEnd) || placeholder;
  const next = selected
    .split("\n")
    .map((line) => prefix + line.replace(/^(#{1,6}\s+|>\s+|- \[ \]\s+|- |\d+\.\s+)/, ""))
    .join("\n");
  replaceMarkdownRange(lineStart, rangeEnd, next, prefix.length, Math.max(placeholder.length, selected.length));
}

function insertMarkdown(markdown) {
  const { selectionStart, selectionEnd } = markdownSource;
  replaceMarkdownRange(selectionStart, selectionEnd, markdown, 0, markdown.length);
}

function replaceMarkdownRange(start, end, text, selectOffset, selectLength) {
  const value = markdownSource.value;
  markdownSource.value = value.slice(0, start) + text + value.slice(end);
  markdownSource.focus();
  markdownSource.setSelectionRange(start + selectOffset, start + selectOffset + selectLength);
  renderMarkdownPreview();
  scheduleSave();
}

function setMarkdownMode(mode) {
  markdownEditor.dataset.mode = mode;
  toolbarHost.querySelectorAll("[data-md-mode]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.mdMode === mode);
  });
}

function renderMarkdownPreview() {
  markdownPreview.innerHTML = markdownToHtml(markdownSource.value);
}

function markdownToHtml(markdown) {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const html = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (line.startsWith("```")) {
      const code = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith("```")) {
        code.push(lines[index]);
        index += 1;
      }
      index += 1;
      html.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      html.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      index += 1;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quote = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quote.push(lines[index].replace(/^>\s?/, ""));
        index += 1;
      }
      html.push(`<blockquote>${paragraphsToHtml(quote)}</blockquote>`);
      continue;
    }

    if (isMarkdownTableStart(lines, index)) {
      const table = collectMarkdownTable(lines, index);
      html.push(markdownTableToHtml(table.rows));
      index = table.nextIndex;
      continue;
    }

    if (/^\s*[-*]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line);
      const tag = ordered ? "ol" : "ul";
      const items = [];
      const pattern = ordered ? /^\s*\d+\.\s+/ : /^\s*[-*]\s+/;
      while (index < lines.length && pattern.test(lines[index])) {
        const item = lines[index].replace(pattern, "");
        const task = item.match(/^\[( |x|X)\]\s+(.+)$/);
        items.push(task
          ? `<li><input type="checkbox" disabled${task[1].toLowerCase() === "x" ? " checked" : ""}> ${inlineMarkdown(task[2])}</li>`
          : `<li>${inlineMarkdown(item)}</li>`);
        index += 1;
      }
      html.push(`<${tag}>${items.join("")}</${tag}>`);
      continue;
    }

    const paragraph = [];
    while (
      index < lines.length &&
      lines[index].trim() &&
      !lines[index].startsWith("```") &&
      !/^(#{1,6})\s+/.test(lines[index]) &&
      !/^>\s?/.test(lines[index]) &&
      !/^\s*[-*]\s+/.test(lines[index]) &&
      !/^\s*\d+\.\s+/.test(lines[index])
    ) {
      paragraph.push(lines[index]);
      index += 1;
    }
    html.push(`<p>${inlineMarkdown(paragraph.join(" "))}</p>`);
  }

  return html.join("") || "<p class=\"note__markdown-empty\">Nothing to preview yet.</p>";
}

function paragraphsToHtml(lines) {
  return lines.join("\n").split(/\n{2,}/).map((block) => `<p>${inlineMarkdown(block.replace(/\n/g, " "))}</p>`).join("");
}

function isMarkdownTableStart(lines, index) {
  return isMarkdownTableRow(lines[index]) && isMarkdownTableDivider(lines[index + 1] || "");
}

function collectMarkdownTable(lines, index) {
  const rows = [];
  while (index < lines.length && isMarkdownTableRow(lines[index])) {
    if (!isMarkdownTableDivider(lines[index])) {
      rows.push(splitMarkdownTableRow(lines[index]));
    }
    index += 1;
  }
  return { rows, nextIndex: index };
}

function markdownTableToHtml(rows) {
  if (!rows.length) return "";
  const [head, ...body] = rows;
  const header = `<thead><tr>${head.map((cell) => `<th>${inlineMarkdown(cell)}</th>`).join("")}</tr></thead>`;
  const bodyRows = body.map((row) => `<tr>${row.map((cell) => `<td>${inlineMarkdown(cell)}</td>`).join("")}</tr>`).join("");
  return `<table>${header}<tbody>${bodyRows}</tbody></table>`;
}

function isMarkdownTableRow(line) {
  return /^\s*\|.+\|\s*$/.test(line);
}

function isMarkdownTableDivider(line) {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function splitMarkdownTableRow(line) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

function inlineMarkdown(text) {
  let value = escapeHtml(text);
  value = value.replace(/`([^`]+)`/g, "<code>$1</code>");
  value = value.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (match, alt, src) => {
    const safeSrc = safeMarkdownUrl(src, true);
    return safeSrc ? `<img alt="${alt}" src="${safeSrc}">` : match;
  });
  value = value.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (match, label, href) => {
    const safeHref = safeMarkdownUrl(href, false);
    return safeHref ? `<a href="${safeHref}" target="_blank" rel="noreferrer noopener">${label}</a>` : label;
  });
  value = value.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  value = value.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  value = value.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
  value = value.replace(/(^|[^_])_([^_]+)_/g, "$1<em>$2</em>");
  return value;
}

function safeMarkdownUrl(url, imageOnly) {
  const value = url.replace(/&amp;/g, "&").trim();
  try {
    const parsed = new URL(value, location.href);
    const allowed = imageOnly
      ? ["http:", "https:", "data:"]
      : ["http:", "https:", "mailto:", "tel:"];
    if (!allowed.includes(parsed.protocol)) return "";
    if (imageOnly && parsed.protocol === "data:" && !/^data:image\//i.test(value)) return "";
    return escapeHtml(value);
  } catch {
    return "";
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[char]);
}

const LOREM_PROFILES = {
  plain: {
    titles: [
      "Plain Text Lorem Ipsum Packet",
      "Plain Text Lorem Ipsum Memo",
      "Plain Text Lorem Ipsum Scratchpad"
    ],
    sections: ["Plain text checklist", "Linear note trail", "Unstyled working queue"],
    paragraphs: [
      "Lorem ipsum plainum keeps the note intentionally simple, using only sentences, spacing, and direct language for fast drafting.",
      "Integer textus libero moves through quiet lines without rich marks, tables, or preview panes, leaving every placeholder easy to copy.",
      "Nulla plaina vitae elit reads like a quick desk note, where each phrase stays lightweight and every section remains unformatted.",
      "Curabitur lineam porttitor gathers short reminders in a clean text stream, ready for editing without structural decoration."
    ],
    items: [
      "Plain item for a direct note.",
      "Simple reference line.",
      "Unformatted reminder.",
      "Quick text-only placeholder.",
      "Short follow-up sentence."
    ],
    quotes: [
      "Plain lorem stays useful when the format should disappear.",
      "A simple note can carry the whole draft."
    ]
  },
  markdown: {
    titles: [
      "Markdown Lorem Ipsum Blueprint",
      "Markdown Lorem Ipsum Draft Map",
      "Markdown Lorem Ipsum Reference"
    ],
    sections: ["Markdown checklist", "Preview-ready outline", "Source note plan"],
    paragraphs: [
      "Lorem ipsum markdownum uses headings, emphasis, and source-friendly spacing so the preview pane has real structure to render.",
      "Praesent `inline-code` cursus magna keeps sample syntax visible while still reading like placeholder prose for a technical note.",
      "Vivamus sagittis markdown lacus adds links, quoted ideas, and list patterns that are easy to test in source and split views.",
      "Aenean markdown bibendum nulla keeps the raw text expressive without pretending to be rich HTML."
    ],
    items: [
      "Toggle the preview pane.",
      "Check heading depth.",
      "Review list rendering.",
      "Keep source readable.",
      "Validate Markdown export."
    ],
    quotes: [
      "Markdown lorem should reveal the syntax as much as the sentence.",
      "A source note is strongest when the structure is visible."
    ]
  },
  milkdown: {
    titles: [
      "Milkdown Lorem Ipsum Canvas",
      "Milkdown Lorem Ipsum Workspace",
      "Milkdown Lorem Ipsum Blocks"
    ],
    sections: ["WYSIWYG Markdown blocks", "Editable canvas tasks", "Milkdown planning lane"],
    paragraphs: [
      "Lorem ipsum milkdownum blends Markdown intent with a WYSIWYG surface, giving the note block-level content to reshape.",
      "Donec crepe cursus magna keeps the sample friendly for visual editing while retaining Markdown underneath the editor.",
      "Curabitur milkdown tempus porttitor creates a note that feels like blocks, tasks, and quotes instead of raw source alone.",
      "Nullam canvas vehicula starts as placeholder prose and can be rearranged inside the Milkdown editing surface."
    ],
    items: [
      "Drag this idea into shape.",
      "Turn this block into a task.",
      "Keep the WYSIWYG flow moving.",
      "Review the generated Markdown.",
      "Refine this editable canvas."
    ],
    quotes: [
      "Milkdown lorem should feel like editable blocks, not plain source.",
      "The canvas can be random while the Markdown remains clean."
    ]
  },
  tinymce: {
    titles: [
      "TinyMCE Lorem Ipsum Composition",
      "TinyMCE Lorem Ipsum Article",
      "TinyMCE Lorem Ipsum Rich Draft"
    ],
    sections: ["Rich formatting pass", "Editorial table", "TinyMCE layout notes"],
    paragraphs: [
      "Lorem ipsum editorialis uses bold marks, linked phrases, and table-ready content to exercise the TinyMCE toolbar.",
      "Etiam porta rich text magna gives the sample a polished article rhythm with formatting that belongs in a full toolbar editor.",
      "Morbi leo compositum keeps the paragraph suitable for alignment, links, and rich paste behavior inside TinyMCE.",
      "Maecenas formatting varius adds enough visual texture to distinguish this from Markdown, Tiptap, and plain text notes."
    ],
    items: [
      "Apply toolbar formatting.",
      "Review rich text spacing.",
      "Try a table cell.",
      "Check linked copy.",
      "Polish the article body."
    ],
    quotes: [
      "TinyMCE lorem should look like an edited rich-text composition.",
      "A toolbar note deserves visible formatting variety."
    ]
  },
  tiptap: {
    titles: [
      "Tiptap Lorem Ipsum Flow",
      "Tiptap Lorem Ipsum Thread",
      "Tiptap Lorem Ipsum Quick Blocks"
    ],
    sections: ["Keyboard-first blocks", "Minimal editor flow", "Tiptap action trail"],
    paragraphs: [
      "Lorem ipsum tiptap keeps the content nimble, using compact blocks that fit a keyboard-first editor.",
      "Praesent node cursus magna moves through short paragraphs, highlighted action words, and lightweight block structure.",
      "Vivamus flow lacus keeps the note distinct from TinyMCE by focusing on minimal rich blocks instead of editorial tables.",
      "Aenean thread bibendum nulla gives Tiptap a quick rhythm for composing, selecting, and restructuring content."
    ],
    items: [
      "Nudge this block forward.",
      "Keep the editor flow lean.",
      "Capture a keyboard-first action.",
      "Reshape this quick thread.",
      "Trim the rich block later."
    ],
    quotes: [
      "Tiptap lorem should feel quick, modular, and easy to reshape.",
      "Small blocks can still carry useful placeholder weight."
    ]
  },
  native: {
    titles: [
      "Rich Text Lorem Ipsum Note",
      "Rich Text Lorem Ipsum Pad",
      "Rich Text Lorem Ipsum Section"
    ],
    sections: ["Native rich text area", "Simple formatted block", "Rich text fallback"],
    paragraphs: [
      "Lorem ipsum native keeps the rich editor path distinct with gentle formatting and browser-native editing behavior.",
      "Donec rich text cursus magna gives the fallback editor content with headings, lists, and quotes without a third-party toolbar.",
      "Curabitur native tempus porttitor adds structured prose that stays readable even in the simplest rich text surface.",
      "Nullam formatted vehicula keeps this note separate from TinyMCE, Tiptap, Markdown, and plain text samples."
    ],
    items: [
      "Check native editing.",
      "Keep a formatted fallback.",
      "Review simple rich blocks.",
      "Preserve readable spacing.",
      "Use this as browser-native filler."
    ],
    quotes: [
      "Native rich text lorem should stay formatted but uncomplicated.",
      "A fallback editor still deserves distinct sample content."
    ]
  }
};

function installLoremControls() {
  if (!loremButton) return;
  loremButton.addEventListener("click", fillWithLoremIpsum);
}

async function fillWithLoremIpsum() {
  if (!loremButton) return;

  closeExportMenu();
  loremButton.disabled = true;
  try {
    saveState.textContent = "Filling…";
    await setCurrentEditorContent(appendLoremContent(safeGetContent(), state.type));
    await saveNow();
  } catch (error) {
    console.error(error);
    showError("Could not fill this note with Lorem Ipsum text. Please try again.");
    saveState.textContent = "Saved";
  } finally {
    loremButton.disabled = false;
  }
}

async function setCurrentEditorContent(content) {
  if (state.type === "plain") {
    plainEditor.value = content;
    state.getContent = () => plainEditor.value;
    plainEditor.focus();
    return;
  }

  if (state.type === "markdown") {
    markdownSource.value = content;
    renderMarkdownPreview();
    state.getContent = () => markdownSource.value;
    markdownSource.focus();
    return;
  }

  if (state.type === "milkdown") {
    if (!window.NotepadLibraryMilkdown?.create) throw new Error("milkdown-unavailable");
    state.instance?.destroy?.();
    const editor = window.NotepadLibraryMilkdown.create(milkdownEditor, content, scheduleSave);
    state.instance = editor;
    state.getContent = () => editor.getMarkdown();
    await editor.ready;
    editor.focus();
    return;
  }

  if (state.type === "tinymce" && state.instance?.setContent) {
    state.instance.setContent(content);
    state.instance.focus();
    return;
  }

  if (state.type === "ckeditor" && state.instance?.setData) {
    state.instance.setData(content);
    state.instance.editing.view.focus();
    return;
  }

  if (state.type === "tiptap") {
    if (!window.PageStudioTiptap?.create) throw new Error("tiptap-unavailable");
    state.instance?.destroy?.();
    richEditor.innerHTML = content;
    const editor = window.PageStudioTiptap.create(richEditor);
    showTiptapToolbar(editor);
    state.instance = editor;
    state.getContent = () => (typeof editor.getHTML === "function" ? editor.getHTML() : richEditor.innerHTML);
    editor.focus?.();
    return;
  }

  richEditor.innerHTML = content;
  state.getContent = () => richEditor.innerHTML;
  richEditor.focus();
}

function appendLoremContent(currentContent, type) {
  const nextContent = loremContentForType(type);
  if (!hasMeaningfulContent(currentContent, type)) return nextContent;

  if (type === "plain" || isMarkdownEditor(type)) {
    return `${currentContent.replace(/\s*$/, "")}\n\n${nextContent}`;
  }

  return `${currentContent.trimEnd()}<hr>${nextContent}`;
}

function loremContentForType(type) {
  let content = "";
  for (let attempt = 0; attempt < 12; attempt += 1) {
    content = renderLoremSample(randomLoremSample(type), type);
    if (!state.loremHistory.has(content)) break;
  }

  state.loremHistory.add(content);
  if (state.loremHistory.size > 60) {
    state.loremHistory.delete(state.loremHistory.values().next().value);
  }
  return content;
}

function renderLoremSample(sample, type) {
  if (type === "plain") return loremPlainText(sample);
  if (type === "markdown") return loremMarkdown(sample);
  if (type === "milkdown") return loremMilkdownMarkdown(sample);
  if (type === "tinymce") return loremTinyMceHtml(sample);
  if (type === "tiptap") return loremTiptapHtml(sample);
  return loremNativeHtml(sample);
}

function randomLoremSample(type) {
  const profile = loremProfileForType(type);
  return {
    title: randomItem(profile.titles),
    section: randomItem(profile.sections),
    paragraphs: randomItems(profile.paragraphs, 2),
    items: randomItems(profile.items, 3),
    quote: randomItem(profile.quotes)
  };
}

function loremProfileForType(type) {
  return LOREM_PROFILES[type] || LOREM_PROFILES.native;
}

function loremPlainText(sample) {
  return `${sample.title}

${sample.paragraphs[0]}

${sample.section.toUpperCase()}
1. ${sample.items[0]}
2. ${sample.items[1]}
3. ${sample.items[2]}

${sample.paragraphs[1]}

${sample.quote}`;
}

function loremMarkdown(sample) {
  return `# ${sample.title}

${sample.paragraphs[0]}

## ${sample.section}

${sample.paragraphs[1]}

- ${sample.items[0]}
- ${sample.items[1]}
- ${sample.items[2]}

| Markdown Field | Placeholder |
| --- | --- |
| Editor | Source and preview |
| Shape | Split-pane Markdown |

> ${sample.quote}`;
}

function loremMilkdownMarkdown(sample) {
  return `# ${sample.title}

${sample.paragraphs[0]}

### ${sample.section}

- [ ] ${sample.items[0]}
- [ ] ${sample.items[1]}
- [x] ${sample.items[2]}

${sample.paragraphs[1]}

> ${sample.quote}`;
}

function loremTinyMceHtml(sample) {
  return `<h1>${escapeHtml(sample.title)}</h1>
<p><strong>TinyMCE rich sample.</strong> ${escapeHtml(sample.paragraphs[0])}</p>
<h2>${escapeHtml(sample.section)}</h2>
<p>${escapeHtml(sample.paragraphs[1])}</p>
<table>
  <tbody>
    <tr><th>Rich area</th><th>Sample detail</th></tr>
    <tr><td>Toolbar</td><td>${escapeHtml(sample.items[0])}</td></tr>
    <tr><td>Review</td><td>${escapeHtml(sample.items[1])}</td></tr>
  </tbody>
</table>
<blockquote>${escapeHtml(sample.quote)}</blockquote>`;
}

function loremTiptapHtml(sample) {
  return `<h1>${escapeHtml(sample.title)}</h1>
<p><em>Tiptap flow.</em> ${escapeHtml(sample.paragraphs[0])}</p>
<h3>${escapeHtml(sample.section)}</h3>
<ul>
${sample.items.map((item) => `  <li>${escapeHtml(item)}</li>`).join("\n")}
</ul>
<p><code>tiptap-lorem-block</code> ${escapeHtml(sample.paragraphs[1])}</p>
<blockquote>${escapeHtml(sample.quote)}</blockquote>`;
}

function loremNativeHtml(sample) {
  return `<h1>${escapeHtml(sample.title)}</h1>
<p><u>Native rich text.</u> ${escapeHtml(sample.paragraphs[0])}</p>
<h2>${escapeHtml(sample.section)}</h2>
<ol>
${sample.items.map((item) => `  <li>${escapeHtml(item)}</li>`).join("\n")}
</ol>
<p>${escapeHtml(sample.paragraphs[1])}</p>
<blockquote>${escapeHtml(sample.quote)}</blockquote>`;
}

function randomItems(items, count) {
  const pool = [...items];
  const selected = [];
  while (selected.length < count && pool.length) {
    selected.push(pool.splice(randomIndex(pool.length), 1)[0]);
  }
  return selected;
}

function randomItem(items) {
  return items[randomIndex(items.length)];
}

function randomIndex(length) {
  if (length <= 1) return 0;
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return values[0] % length;
}

function hasMeaningfulContent(content, type) {
  if (type === "plain" || isMarkdownEditor(type)) return Boolean(content.trim());
  return Boolean(htmlToText(content).trim());
}

function installExportControls() {
  if (!exportButton || !exportMenu) return;

  exportButton.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleExportMenu();
  });

  exportMenu.addEventListener("click", (event) => {
    const target = event.target instanceof Element
      ? event.target.closest("[data-export-format]")
      : null;
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    closeExportMenu();
    exportCurrentNote(target.dataset.exportFormat);
  });

  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest(".note__export")) return;
    closeExportMenu();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeExportMenu();
  });
}

function toggleExportMenu() {
  if (!exportButton || !exportMenu) return;
  const open = exportMenu.hidden;
  exportMenu.hidden = !open;
  exportButton.setAttribute("aria-expanded", String(open));
}

function closeExportMenu() {
  if (!exportButton || !exportMenu) return;
  exportMenu.hidden = true;
  exportButton.setAttribute("aria-expanded", "false");
}

async function exportCurrentNote(format) {
  if (!format || !exportButton) return;

  exportButton.disabled = true;
  try {
    saveState.textContent = "Exporting…";
    await saveNow();
    const record = {
      ...(state.record || {}),
      id: state.id,
      type: state.type,
      title: noteTitle.value.trim() || state.record?.title || "Untitled note",
      content: safeGetContent()
    };
    const exportFile = buildExportFile(format, record);
    downloadBlob(exportFile.content, exportFile.filename, exportFile.mimeType);
    saveState.textContent = "Saved";
  } catch (error) {
    console.error(error);
    showError("Could not export this note. Please try again.");
    saveState.textContent = "Saved";
  } finally {
    exportButton.disabled = false;
  }
}

function buildExportFile(format, record) {
  const title = record.title || "Untitled note";
  const type = record.type || "native";
  const content = record.content || "";

  if (format === "markdown") {
    return {
      content: contentAsMarkdown(content, type),
      filename: exportFilename(title, "md"),
      mimeType: "text/markdown;charset=utf-8"
    };
  }

  if (format === "html") {
    return {
      content: buildHtmlExport(title, contentAsHtml(content, type)),
      filename: exportFilename(title, "html"),
      mimeType: "text/html;charset=utf-8"
    };
  }

  if (format === "text") {
    return {
      content: contentAsText(content, type),
      filename: exportFilename(title, "txt"),
      mimeType: "text/plain;charset=utf-8"
    };
  }

  return {
    content: JSON.stringify(buildJsonExport(record), null, 2),
    filename: exportFilename(title, "json"),
    mimeType: "application/json;charset=utf-8"
  };
}

function buildJsonExport(record) {
  const type = record.type || "native";
  const content = record.content || "";
  return {
    id: record.id || null,
    title: record.title || "Untitled note",
    editor: EDITOR_LABELS[type] || "Note",
    type,
    contentFormat: contentFormatForType(type),
    content,
    markdown: contentAsMarkdown(content, type),
    html: contentAsHtml(content, type),
    text: contentAsText(content, type),
    createdAt: formatIsoDate(record.createdAt),
    updatedAt: formatIsoDate(record.updatedAt),
    exportedAt: new Date().toISOString()
  };
}

function contentFormatForType(type) {
  if (isMarkdownEditor(type)) return "markdown";
  if (type === "plain") return "text";
  return "html";
}

function contentAsMarkdown(content, type) {
  if (isMarkdownEditor(type) || type === "plain") return content;
  return htmlToMarkdown(content);
}

function contentAsHtml(content, type) {
  if (isMarkdownEditor(type)) return content.trim() ? markdownToHtml(content) : "";
  if (type === "plain") return `<pre>${escapeHtml(content)}</pre>`;
  return content;
}

function contentAsText(content, type) {
  if (type === "plain") return content;
  if (isMarkdownEditor(type)) return content.trim() ? htmlToText(markdownToHtml(content)) : "";
  return htmlToText(content);
}

function isMarkdownEditor(type) {
  return type === "markdown" || type === "milkdown";
}

function buildHtmlExport(title, bodyHtml) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(title)}</title>
    <style>
      body { color: #202a31; font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; line-height: 1.6; margin: 0; padding: 32px; }
      main { max-width: 880px; margin: 0 auto; }
      h1 { font-size: 28px; line-height: 1.2; margin: 0 0 24px; }
      img { max-width: 100%; }
      table { border-collapse: collapse; width: 100%; }
      th, td { border: 1px solid #dce3e8; padding: 8px 10px; text-align: left; }
      pre { background: #f4f7f9; border-radius: 8px; overflow: auto; padding: 14px; white-space: pre-wrap; }
      code { background: #eef1f4; border-radius: 4px; padding: 0 4px; }
      pre code { background: transparent; padding: 0; }
    </style>
  </head>
  <body>
    <main>
      <h1>${escapeHtml(title)}</h1>
      ${bodyHtml || "<p></p>"}
    </main>
  </body>
</html>
`;
}

function htmlToText(html) {
  const template = document.createElement("template");
  template.innerHTML = html || "";
  template.content.querySelectorAll("br").forEach((node) => {
    node.replaceWith(document.createTextNode("\n"));
  });
  template.content.querySelectorAll("p, div, h1, h2, h3, h4, h5, h6, li, blockquote, tr").forEach((node) => {
    node.append(document.createTextNode("\n"));
  });
  return (template.content.textContent || "").replace(/\n{3,}/g, "\n\n").trim();
}

function htmlToMarkdown(html) {
  const template = document.createElement("template");
  template.innerHTML = html || "";
  return Array.from(template.content.childNodes)
    .map((node) => nodeToMarkdown(node))
    .join("")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function nodeToMarkdown(node) {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.nodeValue || "";
  }
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return "";
  }

  const tag = node.tagName.toLowerCase();
  const children = () => Array.from(node.childNodes).map((child) => nodeToMarkdown(child)).join("");
  const text = () => children().trim();

  if (tag === "br") return "\n";
  if (/^h[1-6]$/.test(tag)) return `\n\n${"#".repeat(Number(tag.slice(1)))} ${text()}\n\n`;
  if (tag === "p" || tag === "div" || tag === "section" || tag === "article") return `\n\n${text()}\n\n`;
  if (tag === "strong" || tag === "b") return `**${text()}**`;
  if (tag === "em" || tag === "i") return `_${text()}_`;
  if (tag === "u") return text();
  if (tag === "s" || tag === "del") return `~~${text()}~~`;
  if (tag === "code") return node.closest("pre") ? node.textContent || "" : `\`${node.textContent || ""}\``;
  if (tag === "pre") return `\n\n\`\`\`\n${node.textContent || ""}\n\`\`\`\n\n`;
  if (tag === "blockquote") {
    return `\n\n${text().split("\n").map((line) => `> ${line}`).join("\n")}\n\n`;
  }
  if (tag === "a") {
    const href = node.getAttribute("href");
    const label = text() || href || "";
    return href ? `[${label}](${href})` : label;
  }
  if (tag === "img") {
    const src = node.getAttribute("src");
    if (!src) return "";
    return `![${node.getAttribute("alt") || ""}](${src})`;
  }
  if (tag === "ul" || tag === "ol") return listToMarkdown(node, tag === "ol");
  if (tag === "table") return tableToMarkdown(node);
  if (tag === "hr") return "\n\n---\n\n";

  return children();
}

function listToMarkdown(list, ordered) {
  return `\n${Array.from(list.children)
    .filter((child) => child.tagName?.toLowerCase() === "li")
    .map((item, index) => {
      const nestedLists = Array.from(item.children).filter((child) => ["ul", "ol"].includes(child.tagName?.toLowerCase()));
      const clone = item.cloneNode(true);
      clone.querySelectorAll("ul, ol").forEach((node) => node.remove());
      const marker = ordered ? `${index + 1}.` : "-";
      const nested = nestedLists.map((node) => nodeToMarkdown(node).trim().split("\n").map((line) => `  ${line}`).join("\n")).join("\n");
      return `${marker} ${htmlToMarkdown(clone.innerHTML)}${nested ? `\n${nested}` : ""}`;
    })
    .join("\n")}\n\n`;
}

function tableToMarkdown(table) {
  const rows = Array.from(table.querySelectorAll("tr")).map((row) => (
    Array.from(row.children).map((cell) => normalizeMarkdownCell(cell.textContent || ""))
  )).filter((row) => row.length);
  if (!rows.length) return "";

  const [head, ...body] = rows;
  const divider = head.map(() => "---");
  return `\n\n| ${head.join(" | ")} |
| ${divider.join(" | ")} |
${body.map((row) => `| ${row.join(" | ")} |`).join("\n")}\n\n`;
}

function normalizeMarkdownCell(value) {
  return value.replace(/\s+/g, " ").replace(/\|/g, "\\|").trim();
}

function exportFilename(title, extension) {
  const slug = String(title || "untitled-note")
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "untitled-note";
  return `${slug}.${extension}`;
}

function formatIsoDate(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
}

function downloadBlob(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
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
  state.record = notes[index];
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
  try {
    return chrome.runtime.getURL(path);
  } catch {
    return new URL(`../${path}`, location.href).href;
  }
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

function loadStylesheet(href) {
  return new Promise((resolve, reject) => {
    const existing = Array.from(document.styleSheets).some((sheet) => sheet.href === href);
    if (existing) {
      resolve();
      return;
    }
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.addEventListener("load", () => resolve(), { once: true });
    link.addEventListener("error", () => reject(new Error(`failed to load ${href}`)), { once: true });
    document.head.appendChild(link);
  });
}

function showError(message) {
  editorError.textContent = message;
  editorError.hidden = false;
}
