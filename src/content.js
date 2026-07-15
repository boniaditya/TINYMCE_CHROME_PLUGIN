(() => {
  if (window.__pageStudioLoaded) {
    return;
  }
  window.__pageStudioLoaded = true;

  const DEFAULT_SETTINGS = {
    editor: "native",
    autosave: true,
    showOutlines: true,
    sanitizeHtml: true
  };

  const EDITORS = {
    native: {
      label: "Native Inline",
      mode: "rich"
    },
    tinymce: {
      label: "TinyMCE Inline",
      mode: "rich",
      vendorScript: "vendor/tinymce/tinymce.min.js"
    },
    tiptap: {
      label: "Tiptap Inline",
      mode: "rich",
      vendorScript: "vendor/tiptap/tiptap.umd.js"
    },
    ckeditor: {
      label: "CKEditor Inline",
      mode: "rich",
      vendorScript: "vendor/ckeditor/ckeditor.js"
    },
    aloha: {
      label: "Aloha Editor",
      mode: "rich",
      vendorScript: "vendor/aloha/lib/aloha.js"
    },
    html: {
      label: "HTML Source",
      mode: "html"
    },
    plain: {
      label: "Plain Text",
      mode: "plain"
    },
    page: {
      label: "Whole Page",
      mode: "page"
    }
  };

  const VOID_TAGS = new Set([
    "AREA",
    "BASE",
    "BR",
    "COL",
    "EMBED",
    "HR",
    "IFRAME",
    "INPUT",
    "LINK",
    "META",
    "PARAM",
    "SOURCE",
    "TRACK",
    "WBR"
  ]);

  const BRIDGE_REQUEST_TIMEOUT_MS = 8000;

  const EDITOR_UI_SELECTOR = [
    "#page-studio-root",
    "[data-page-studio-ui='true']",
    ".tox",
    ".tox-tinymce",
    ".ck",
    ".ck-editor",
    ".cke",
    ".aloha",
    ".aloha-toolbar"
  ].join(",");

  const state = {
    active: false,
    host: null,
    root: null,
    globalStyle: null,
    settings: { ...DEFAULT_SETTINGS },
    hoverElement: null,
    selectedElement: null,
    selectedPath: "",
    edit: null,
    editorOverlay: null,
    imageOverlay: null,
    fileInput: null,
    draftTimer: 0,
    bridgeRequestId: 0,
    bridgeRequests: new Map(),
    bridgeInjected: false,
    bridgeReady: null,
    isResizing: false
  };

  chrome.storage.sync.get(DEFAULT_SETTINGS, (settings) => {
    state.settings = { ...DEFAULT_SETTINGS, ...settings };
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") {
      return;
    }

    for (const [key, change] of Object.entries(changes)) {
      if (key in DEFAULT_SETTINGS) {
        state.settings[key] = change.newValue;
      }
    }
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "PAGE_STUDIO_TOGGLE") {
      toggle();
      sendResponse({ active: state.active, editor: state.settings.editor });
      return true;
    }

    if (message?.type === "PAGE_STUDIO_STATE") {
      sendResponse({
        active: state.active,
        editor: state.settings.editor,
        inline: Boolean(state.edit)
      });
      return true;
    }

    if (message?.type === "PAGE_STUDIO_SETTINGS") {
      state.settings = { ...state.settings, ...message.settings };
      sendResponse({ ok: true });
      return true;
    }

    if (message?.type === "PAGE_STUDIO_CLEAR_DRAFTS") {
      clearDrafts().then((cleared) => sendResponse({ cleared }));
      return true;
    }

    if (message?.type === "PAGE_STUDIO_CAPTURE_DOCUMENT") {
      sendResponse(captureDocumentSnapshot());
      return true;
    }

    if (message?.type === "PAGE_STUDIO_REPLACE_DOCUMENT") {
      replaceDocumentFromHtml(message.html);
      sendResponse({ ok: true });
      return true;
    }

    return false;
  });

  window.addEventListener("message", handleBridgeMessage);

  function toggle() {
    state.active ? deactivate() : activate();
  }

  function activate() {
    state.active = true;
    ensureHost();
    ensureGlobalStyle();
    void injectBridge();
    document.addEventListener("mousemove", handleMouseMove, true);
    document.addEventListener("click", handleDocumentClick, true);
    document.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("paste", handlePaste, true);
    document.addEventListener("drop", handleDrop, true);
    window.addEventListener("scroll", updateEditorOverlays, true);
    window.addEventListener("resize", updateEditorOverlays);

    if (state.settings.editor === "page") {
      beginWholePageEdit();
    }
  }

  function deactivate() {
    state.active = false;
    document.removeEventListener("mousemove", handleMouseMove, true);
    document.removeEventListener("click", handleDocumentClick, true);
    document.removeEventListener("keydown", handleKeyDown, true);
    document.removeEventListener("paste", handlePaste, true);
    document.removeEventListener("drop", handleDrop, true);
    window.removeEventListener("scroll", updateEditorOverlays, true);
    window.removeEventListener("resize", updateEditorOverlays);
    clearHover();
    void finishCurrentEdit({ commit: true });
  }

  function ensureHost() {
    if (state.host?.isConnected) {
      return;
    }

    const host = document.createElement("div");
    host.id = "page-studio-root";
    host.setAttribute("data-page-studio-ui", "true");
    host.style.all = "initial";
    host.style.pointerEvents = "none";
    state.host = host;
    state.root = host.attachShadow({ mode: "open" });
    state.root.innerHTML = `<style>${SHADOW_CSS}</style>`;
    document.documentElement.appendChild(host);
  }

  function ensureGlobalStyle() {
    if (state.globalStyle?.isConnected) {
      return;
    }

    const style = document.createElement("style");
    style.id = "page-studio-global-style";
    style.textContent = GLOBAL_CSS;
    state.globalStyle = style;
    document.documentElement.appendChild(style);
  }

  function injectBridge() {
    if (state.bridgeReady) {
      return state.bridgeReady;
    }

    if (state.bridgeInjected || document.querySelector("script[data-page-studio-bridge]")) {
      state.bridgeInjected = true;
      state.bridgeReady = Promise.resolve(true);
      return state.bridgeReady;
    }

    state.bridgeReady = new Promise((resolve) => {
      const script = document.createElement("script");
      script.src = chrome.runtime.getURL("src/page-editor-bridge.js");
      script.dataset.pageStudioBridge = "true";
      script.async = false;
      script.addEventListener("load", () => {
        script.remove();
        resolve(true);
      }, { once: true });
      script.addEventListener("error", () => {
        state.bridgeInjected = false;
        state.bridgeReady = null;
        resolve(false);
      }, { once: true });
      (document.head || document.documentElement).appendChild(script);
      state.bridgeInjected = true;
    });

    return state.bridgeReady;
  }

  function handleMouseMove(event) {
    if (!state.active || state.settings.editor === "page" || state.isResizing || isEditorUiTarget(event.target)) {
      return;
    }

    if (state.edit && state.edit.element.contains(event.target)) {
      clearHover();
      return;
    }

    const candidate = getEditableCandidate(event.target, event);
    if (!candidate || candidate === state.selectedElement) {
      clearHover();
      return;
    }

    if (state.settings.showOutlines) {
      setHover(candidate);
    }
  }

  function handleDocumentClick(event) {
    if (!state.active || state.settings.editor === "page" || state.isResizing || isEditorUiTarget(event.target)) {
      return;
    }

    if (state.edit && state.edit.element.contains(event.target)) {
      return;
    }

    const candidate = getEditableCandidate(event.target, event);
    if (!candidate) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    void beginEdit(candidate);
  }

  function handleKeyDown(event) {
    if (!state.active || !state.edit) {
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      void finishCurrentEdit({ commit: false });
      return;
    }

    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      event.stopPropagation();
      void finishCurrentEdit({ commit: true });
      return;
    }

    if (state.edit.type === "image" && event.key === "Enter") {
      event.preventDefault();
      openImageFilePicker();
    }
  }

  function handlePaste(event) {
    if (!state.active || state.edit?.type !== "image") {
      return;
    }

    const clipboard = event.clipboardData;
    if (!clipboard) {
      return;
    }

    const imageFile = Array.from(clipboard.files).find((file) => file.type.startsWith("image/"));
    if (imageFile) {
      event.preventDefault();
      setImageFromFile(imageFile);
      return;
    }

    const url = clipboard.getData("text/plain").trim();
    if (isLikelyImageUrl(url)) {
      event.preventDefault();
      setSelectedImageSource(url);
    }
  }

  function handleDrop(event) {
    if (!state.active || state.edit?.type !== "image") {
      return;
    }

    const transfer = event.dataTransfer;
    if (!transfer) {
      return;
    }

    const imageFile = Array.from(transfer.files).find((file) => file.type.startsWith("image/"));
    const url = transfer.getData("text/uri-list") || transfer.getData("text/plain");
    if (!imageFile && !isLikelyImageUrl(url)) {
      return;
    }

    event.preventDefault();
    if (imageFile) {
      setImageFromFile(imageFile);
    } else {
      setSelectedImageSource(url.trim());
    }
  }

  function getEditableCandidate(target, event) {
    if (!(target instanceof Element)) {
      return null;
    }

    if (isEditorUiTarget(target) || target.closest("script, style, link, meta, title, noscript")) {
      return null;
    }

    if (event?.altKey && target.parentElement && target.parentElement !== document.documentElement) {
      return target.parentElement;
    }

    if (event?.shiftKey) {
      const block = target.closest("article, section, main, header, footer, nav, aside, figure, table, ul, ol, div");
      if (block && block !== document.documentElement) {
        return block;
      }
    }

    if (target === document.documentElement) {
      return null;
    }

    return target;
  }

  function isEditorUiTarget(target) {
    return target instanceof Element && Boolean(target.closest(EDITOR_UI_SELECTOR));
  }

  function setHover(element) {
    if (state.hoverElement === element) {
      return;
    }

    clearHover();
    state.hoverElement = element;
    element.classList.add("page-studio-hover-outline");
  }

  function clearHover() {
    if (state.hoverElement) {
      state.hoverElement.classList.remove("page-studio-hover-outline");
      state.hoverElement = null;
    }
  }

  async function beginEdit(element) {
    await finishCurrentEdit({ commit: true });
    clearHover();

    state.selectedElement = element;
    state.selectedPath = buildCssPath(element);

    if (element instanceof HTMLImageElement) {
      await beginImageEdit(element);
      return;
    }

    if (isFormField(element)) {
      await beginFormEdit(element);
      return;
    }

    if (VOID_TAGS.has(element.tagName)) {
      await beginBoxEdit(element);
      return;
    }

    await beginContentEdit(element);
  }

  async function beginWholePageEdit() {
    await finishCurrentEdit({ commit: true });
    state.selectedElement = document.body;
    state.selectedPath = "body";
    state.edit = {
      type: "page",
      element: document.body,
      originalHtml: document.body.innerHTML
    };
    document.designMode = "on";
    document.body.contentEditable = "true";
    document.body.classList.add("page-studio-editing-outline");
    renderEditorOverlay(document.body, {
      type: "page",
      label: "Whole Page"
    });
    document.body.focus();
  }

  async function beginContentEdit(element) {
    const editorConfig = EDITORS[state.settings.editor] ?? EDITORS.native;
    const mode = editorConfig.mode === "html" || editorConfig.mode === "plain" ? editorConfig.mode : "rich";
    const originalHtml = element.innerHTML;
    const originalText = element.textContent ?? "";
    const originalContentEditable = element.getAttribute("contenteditable");
    const originalSpellcheck = element.getAttribute("spellcheck");

    state.edit = {
      type: "content",
      element,
      mode,
      editorName: state.settings.editor,
      bridgeEditorId: null,
      originalHtml,
      originalText,
      originalContentEditable,
      originalSpellcheck
    };

    element.classList.add("page-studio-editing-outline");
    element.setAttribute("data-page-studio-editing", "true");
    element.setAttribute("data-page-studio-edit-id", createEditId());
    element.setAttribute("spellcheck", "true");

    const draft = await loadDraft();
    if (draft?.type === "content" && draft.mode === mode) {
      applyContentValue(element, mode, draft.value);
    } else if (mode === "html") {
      element.textContent = originalHtml;
    }

    if (mode === "plain") {
      element.setAttribute("contenteditable", "plaintext-only");
    } else {
      element.setAttribute("contenteditable", "true");
    }

    element.addEventListener("input", scheduleDraftSave);
    element.addEventListener("blur", handleInlineBlur, true);

    if (mode === "rich" && shouldUseVendorEditor(state.settings.editor)) {
      const bridgeResult = await startVendorEditor(element, state.settings.editor);
      if (bridgeResult?.ok) {
        state.edit.bridgeEditorId = bridgeResult.editorId;
        element.dataset.pageStudioEditor = state.settings.editor;
      } else {
        element.dataset.pageStudioEditor = "native";
        console.info(`[Page Studio] ${state.settings.editor} was not available, using native inline editing.`);
      }
    } else {
      element.dataset.pageStudioEditor = mode;
    }

    renderEditorOverlay(element, {
      type: "content",
      mode,
      label: EDITORS[state.settings.editor]?.label || "Inline Editor"
    });
    focusEditableElement(element, mode);
  }

  async function beginFormEdit(element) {
    const originalValue = element.value;
    const originalReadonly = element.getAttribute("readonly");
    const originalDisabled = element.getAttribute("disabled");
    const draft = await loadDraft();

    state.edit = {
      type: "form",
      element,
      originalValue,
      originalReadonly,
      originalDisabled
    };

    element.classList.add("page-studio-editing-outline");
    element.removeAttribute("readonly");
    element.removeAttribute("disabled");
    if (draft?.type === "form") {
      element.value = draft.value;
    }
    element.addEventListener("input", scheduleDraftSave);
    renderEditorOverlay(element, {
      type: "form",
      label: "Form Field"
    });
    element.focus();
    if (typeof element.select === "function") {
      element.select();
    }
  }

  async function beginImageEdit(image) {
    const originalImage = captureImageState(image);
    const draft = await loadDraft();

    state.edit = {
      type: "image",
      element: image,
      originalImage,
      originalTabIndex: image.getAttribute("tabindex")
    };

    image.classList.add("page-studio-editing-outline");
    image.setAttribute("data-page-studio-editing", "true");
    image.setAttribute("tabindex", "0");

    if (draft?.type === "image") {
      applyImageState(image, draft.value);
    }

    image.focus();
    image.addEventListener("load", updateImageOverlayPosition);
    renderEditorOverlay(image, {
      type: "image",
      label: "Image"
    });
    renderImageOverlay(image);
  }

  async function beginBoxEdit(element) {
    const originalStyle = element.getAttribute("style");
    const originalTabIndex = element.getAttribute("tabindex");
    const draft = await loadDraft();

    state.edit = {
      type: "box",
      element,
      originalStyle,
      originalTabIndex
    };

    element.classList.add("page-studio-editing-outline");
    element.setAttribute("data-page-studio-editing", "true");
    element.setAttribute("tabindex", "0");
    if (draft?.type === "box") {
      element.setAttribute("style", draft.value);
    }
    renderEditorOverlay(element, {
      type: "box",
      label: "Element"
    });
    element.focus();
    renderImageOverlay(element);
  }

  function handleInlineBlur(event) {
    if (!state.edit || event.currentTarget !== state.edit.element) {
      return;
    }

    scheduleDraftSave();
  }

  async function finishCurrentEdit({ commit }) {
    const edit = state.edit;
    if (!edit) {
      return;
    }

    window.clearTimeout(state.draftTimer);
    state.edit = null;
    state.selectedElement = null;
    state.selectedPath = "";
    removeEditorOverlay();
    removeImageOverlay(edit);

    if (edit.type === "content") {
      await finishContentEdit(edit, commit);
    } else if (edit.type === "form") {
      finishFormEdit(edit, commit);
    } else if (edit.type === "image") {
      finishImageEdit(edit, commit);
    } else if (edit.type === "box") {
      finishBoxEdit(edit, commit);
    } else if (edit.type === "page") {
      finishPageEdit(edit, commit);
    }

    if (commit) {
      await removeDraftForPath(buildCssPath(edit.element));
    }
  }

  async function finishContentEdit(edit, commit) {
    const { element, mode } = edit;
    let bridgeData = null;

    if (edit.bridgeEditorId) {
      const result = await stopVendorEditor(edit.bridgeEditorId, commit);
      if (result?.ok && typeof result.data === "string") {
        bridgeData = result.data;
      }
    }

    element.removeEventListener("input", scheduleDraftSave);
    element.removeEventListener("blur", handleInlineBlur, true);

    if (!commit) {
      element.innerHTML = edit.originalHtml;
    } else if (mode === "html") {
      const html = state.settings.sanitizeHtml ? sanitizeHTML(element.textContent ?? "") : (element.textContent ?? "");
      element.innerHTML = html;
    } else if (mode === "plain") {
      element.textContent = element.textContent ?? "";
    } else if (bridgeData !== null) {
      element.innerHTML = state.settings.sanitizeHtml ? sanitizeHTML(bridgeData) : bridgeData;
    } else if (state.settings.sanitizeHtml) {
      element.innerHTML = sanitizeHTML(element.innerHTML);
    }

    restoreNullableAttribute(element, "contenteditable", edit.originalContentEditable);
    restoreNullableAttribute(element, "spellcheck", edit.originalSpellcheck);
    element.classList.remove("page-studio-editing-outline");
    element.removeAttribute("data-page-studio-editing");
    element.removeAttribute("data-page-studio-edit-id");
    delete element.dataset.pageStudioEditor;
    fireDomUpdate(element);
  }

  function finishFormEdit(edit, commit) {
    const { element } = edit;
    element.removeEventListener("input", scheduleDraftSave);
    if (!commit) {
      element.value = edit.originalValue;
    }
    restoreNullableAttribute(element, "readonly", edit.originalReadonly);
    restoreNullableAttribute(element, "disabled", edit.originalDisabled);
    element.classList.remove("page-studio-editing-outline");
    fireDomUpdate(element);
  }

  function finishImageEdit(edit, commit) {
    const { element } = edit;
    element.removeEventListener("load", updateImageOverlayPosition);
    if (!commit) {
      restoreImageState(element, edit.originalImage);
    }
    restoreNullableAttribute(element, "tabindex", edit.originalTabIndex);
    element.classList.remove("page-studio-editing-outline");
    element.removeAttribute("data-page-studio-editing");
    fireDomUpdate(element);
  }

  function finishBoxEdit(edit, commit) {
    const { element } = edit;
    if (!commit) {
      restoreNullableAttribute(element, "style", edit.originalStyle);
    }
    restoreNullableAttribute(element, "tabindex", edit.originalTabIndex);
    element.classList.remove("page-studio-editing-outline");
    element.removeAttribute("data-page-studio-editing");
    fireDomUpdate(element);
  }

  function finishPageEdit(edit, commit) {
    document.designMode = "off";
    document.body.removeAttribute("contenteditable");
    document.body.classList.remove("page-studio-editing-outline");
    if (!commit) {
      document.body.innerHTML = edit.originalHtml;
    } else if (state.settings.sanitizeHtml) {
      document.body.innerHTML = sanitizeHTML(document.body.innerHTML);
    }
  }

  function focusEditableElement(element, mode) {
    requestAnimationFrame(() => {
      element.focus();
      if (mode === "html") {
        selectAllText(element);
      } else {
        placeCaretAtEnd(element);
      }
    });
  }

  function selectAllText(element) {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  function placeCaretAtEnd(element) {
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  function shouldUseVendorEditor(editorName) {
    return editorName === "tinymce" || editorName === "tiptap" || editorName === "ckeditor" || editorName === "aloha";
  }

  async function startVendorEditor(element, editorName) {
    const editorConfig = EDITORS[editorName];
    if (!editorConfig?.vendorScript) {
      return { ok: false, reason: "missing-script" };
    }

    const bridgeReady = await injectBridge();
    if (!bridgeReady) {
      return { ok: false, reason: "bridge-unavailable" };
    }

    return requestBridge({
      command: "START_EDITOR",
      editor: editorName,
      selector: `[data-page-studio-edit-id="${element.getAttribute("data-page-studio-edit-id")}"]`,
      scriptUrl: chrome.runtime.getURL(editorConfig.vendorScript),
      baseUrl: chrome.runtime.getURL(editorConfig.vendorScript.split("/").slice(0, -1).join("/"))
    });
  }

  function stopVendorEditor(editorId, commit) {
    return requestBridge({
      command: "STOP_EDITOR",
      editorId,
      commit
    });
  }

  function getVendorEditorData(editorId) {
    return requestBridge({
      command: "GET_DATA",
      editorId
    });
  }

  function runVendorEditorCommand(editorId, commandName, value) {
    return requestBridge({
      command: "RUN_COMMAND",
      editorId,
      commandName,
      value
    });
  }

  function requestBridge(payload) {
    return new Promise((resolve) => {
      const id = `page-studio-${Date.now()}-${++state.bridgeRequestId}`;
      const timeout = window.setTimeout(() => {
        state.bridgeRequests.delete(id);
        resolve({ ok: false, reason: "timeout" });
      }, BRIDGE_REQUEST_TIMEOUT_MS);

      state.bridgeRequests.set(id, { resolve, timeout });
      window.postMessage({
        source: "PAGE_STUDIO_CONTENT",
        id,
        ...payload
      }, "*");
    });
  }

  function handleBridgeMessage(event) {
    if (event.source !== window || event.data?.source !== "PAGE_STUDIO_BRIDGE") {
      return;
    }

    const request = state.bridgeRequests.get(event.data.id);
    if (!request) {
      return;
    }

    window.clearTimeout(request.timeout);
    state.bridgeRequests.delete(event.data.id);
    request.resolve(event.data);
  }

  function renderEditorOverlay(element, config) {
    ensureHost();
    removeEditorOverlay();

    const overlay = document.createElement("div");
    overlay.className = `editor-overlay editor-overlay-${config.type}`;
    overlay.setAttribute("data-page-studio-ui", "true");
    overlay.innerHTML = getEditorOverlayMarkup(config);
    state.root.appendChild(overlay);
    state.editorOverlay = overlay;

    overlay.addEventListener("mousedown", (event) => {
      event.preventDefault();
    });

    overlay.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target.closest("[data-action], [data-command], [data-format]") : null;
      if (!target) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      if (target.dataset.action === "commit") {
        void finishCurrentEdit({ commit: true });
        return;
      }

      if (target.dataset.action === "cancel") {
        void finishCurrentEdit({ commit: false });
        return;
      }

      if (target.dataset.action === "upload-image") {
        openImageFilePicker();
        return;
      }

      if (target.dataset.action === "reset-size") {
        resetSelectedElementSize();
        return;
      }

      if (target.dataset.action === "link") {
        createInlineLink();
        return;
      }

      if (target.dataset.command) {
        void runInlineCommand(target.dataset.command);
        return;
      }

      if (target.dataset.format) {
        void runInlineCommand("formatBlock", target.dataset.format);
      }
    });

    updateEditorOverlayPosition(element);
  }

  function getEditorOverlayMarkup(config) {
    const label = escapeHtml(config.label);
    const formatControls = config.type === "content" && config.mode === "rich"
      ? `
        <span class="overlay-divider"></span>
        <button class="overlay-button" data-command="bold" type="button" title="Bold"><b>B</b></button>
        <button class="overlay-button" data-command="italic" type="button" title="Italic"><i>I</i></button>
        <button class="overlay-button" data-command="underline" type="button" title="Underline"><u>U</u></button>
        <button class="overlay-button" data-format="h2" type="button" title="Heading">H</button>
        <button class="overlay-button" data-command="insertUnorderedList" type="button" title="List">UL</button>
        <button class="overlay-button" data-action="link" type="button" title="Link">Link</button>
      `
      : "";
    const imageControls = config.type === "image" || config.type === "box"
      ? `
        <span class="overlay-divider"></span>
        ${config.type === "image" ? `<button class="overlay-button" data-action="upload-image" type="button">Upload</button>` : ""}
        <button class="overlay-button" data-action="reset-size" type="button">Reset size</button>
      `
      : "";

    return `
      <div class="overlay-row">
        <span class="overlay-label">${label}</span>
        ${formatControls}
        ${imageControls}
        <span class="overlay-spacer"></span>
        <button class="overlay-button overlay-cancel" data-action="cancel" type="button">Cancel</button>
        <button class="overlay-button overlay-done" data-action="commit" type="button">Done</button>
      </div>
    `;
  }

  function removeEditorOverlay() {
    if (state.editorOverlay) {
      state.editorOverlay.remove();
      state.editorOverlay = null;
    }
  }

  function updateEditorOverlays() {
    updateEditorOverlayPosition();
    updateImageOverlayPosition();
  }

  function updateEditorOverlayPosition(element = state.edit?.element) {
    const overlay = state.editorOverlay;
    if (!overlay || !(element instanceof Element) || !element.isConnected) {
      return;
    }

    const rect = element === document.body
      ? { left: 12, top: 12, width: Math.min(window.innerWidth - 24, 760), height: window.innerHeight - 24 }
      : element.getBoundingClientRect();
    const overlayWidth = Math.min(Math.max(rect.width, 280), window.innerWidth - 16);
    overlay.style.width = `${Math.round(overlayWidth)}px`;

    const overlayHeight = overlay.offsetHeight || 42;
    const maxLeft = window.innerWidth - overlayWidth - 8;
    const left = clamp(rect.left, 8, Math.max(8, maxLeft));
    const preferredTop = rect.top + 8;
    const aboveTop = rect.top - overlayHeight - 8;
    const belowTop = rect.bottom + 8;
    let top = preferredTop >= 8 ? preferredTop : belowTop;
    if (top + overlayHeight > window.innerHeight - 8) {
      top = aboveTop >= 8 ? aboveTop : window.innerHeight - overlayHeight - 8;
    }

    overlay.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  }

  async function runInlineCommand(command, value = null) {
    const edit = state.edit;
    if (!edit) {
      return;
    }

    if (edit.bridgeEditorId && edit.editorName === "tiptap") {
      const result = await runVendorEditorCommand(edit.bridgeEditorId, command, value);
      if (result?.ok) {
        scheduleDraftSave();
      }
      return;
    }

    if (edit.element instanceof HTMLElement) {
      edit.element.focus();
    }
    document.execCommand(command, false, value);
    scheduleDraftSave();
  }

  function createInlineLink() {
    const href = window.prompt("URL");
    if (!href) {
      return;
    }

    void runInlineCommand("createLink", href);
  }

  function resetSelectedElementSize() {
    const element = state.edit?.element;
    if (!(element instanceof HTMLElement || element instanceof SVGElement)) {
      return;
    }

    element.style.removeProperty("width");
    element.style.removeProperty("height");
    if (element instanceof HTMLImageElement) {
      element.removeAttribute("width");
      element.removeAttribute("height");
    }
    updateEditorOverlays();
    scheduleDraftSave();
  }

  function renderImageOverlay(element) {
    ensureHost();
    removeImageOverlay();

    const overlay = document.createElement("div");
    overlay.className = "image-overlay";
    overlay.setAttribute("data-page-studio-ui", "true");
    overlay.innerHTML = `
      <span class="image-handle image-handle-nw" data-resize="nw"></span>
      <span class="image-handle image-handle-ne" data-resize="ne"></span>
      <span class="image-handle image-handle-se" data-resize="se"></span>
      <span class="image-handle image-handle-sw" data-resize="sw"></span>
    `;
    state.root.appendChild(overlay);
    state.imageOverlay = overlay;

    for (const handle of overlay.querySelectorAll("[data-resize]")) {
      handle.addEventListener("pointerdown", (event) => startResize(event, element, handle.dataset.resize));
    }

    if (element instanceof HTMLImageElement) {
      element.addEventListener("dblclick", openImageFilePicker);
    }

    updateEditorOverlays();
  }

  function removeImageOverlay(edit = state.edit) {
    if (state.imageOverlay) {
      state.imageOverlay.remove();
      state.imageOverlay = null;
    }

    if (edit?.element instanceof HTMLImageElement) {
      edit.element.removeEventListener("dblclick", openImageFilePicker);
    }
  }

  function updateImageOverlayPosition() {
    const overlay = state.imageOverlay;
    const element = state.edit?.element;
    if (!overlay || !(element instanceof Element) || !element.isConnected) {
      return;
    }

    const rect = element.getBoundingClientRect();
    overlay.style.transform = `translate(${Math.round(rect.left)}px, ${Math.round(rect.top)}px)`;
    overlay.style.width = `${Math.round(rect.width)}px`;
    overlay.style.height = `${Math.round(rect.height)}px`;
  }

  function startResize(event, element, direction) {
    event.preventDefault();
    event.stopPropagation();
    state.isResizing = true;

    const rect = element.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const startWidth = rect.width;
    const startHeight = rect.height;
    const aspectRatio = startWidth / Math.max(1, startHeight);

    const handleMove = (moveEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;
      const horizontal = direction.includes("w") ? -deltaX : deltaX;
      const vertical = direction.includes("n") ? -deltaY : deltaY;
      let nextWidth = Math.max(24, startWidth + horizontal);
      let nextHeight = Math.max(24, startHeight + vertical);

      if (moveEvent.shiftKey) {
        if (Math.abs(horizontal) > Math.abs(vertical)) {
          nextHeight = nextWidth / aspectRatio;
        } else {
          nextWidth = nextHeight * aspectRatio;
        }
      }

      element.style.width = `${Math.round(nextWidth)}px`;
      element.style.height = `${Math.round(nextHeight)}px`;
      updateEditorOverlays();
      scheduleDraftSave();
    };

    const handleUp = () => {
      state.isResizing = false;
      window.removeEventListener("pointermove", handleMove, true);
      window.removeEventListener("pointerup", handleUp, true);
    };

    window.addEventListener("pointermove", handleMove, true);
    window.addEventListener("pointerup", handleUp, true);
  }

  function openImageFilePicker() {
    if (state.edit?.type !== "image") {
      return;
    }

    ensureHost();
    if (!state.fileInput) {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      input.className = "hidden-file-input";
      input.addEventListener("change", () => {
        const [file] = input.files ?? [];
        if (file) {
          setImageFromFile(file);
        }
        input.value = "";
      });
      state.root.appendChild(input);
      state.fileInput = input;
    }

    state.fileInput.click();
  }

  function setImageFromFile(file) {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      setSelectedImageSource(String(reader.result ?? ""));
    });
    reader.readAsDataURL(file);
  }

  function setSelectedImageSource(src) {
    const image = state.edit?.element;
    if (!(image instanceof HTMLImageElement)) {
      return;
    }

    image.src = src;
    image.removeAttribute("srcset");
    image.removeAttribute("sizes");
    clearPictureSources(image);
    scheduleDraftSave();
    updateEditorOverlays();
  }

  function isLikelyImageUrl(value) {
    const trimmed = String(value ?? "").trim();
    return /^(https?:|data:image\/|blob:|\/|\.\/|\.\.\/)/i.test(trimmed) &&
      (/\.(png|jpe?g|gif|webp|avif|svg)(\?.*)?$/i.test(trimmed) || /^data:image\//i.test(trimmed) || /^blob:/i.test(trimmed));
  }

  function scheduleDraftSave() {
    window.clearTimeout(state.draftTimer);
    if (!state.settings.autosave || !state.edit) {
      return;
    }

    state.draftTimer = window.setTimeout(saveDraft, 350);
  }

  async function saveDraft() {
    if (!state.edit || !state.selectedPath) {
      return;
    }

    try {
      const draftValue = await getCurrentDraftValue();
      await chrome.storage.local.set({
        [getDraftKey(state.selectedPath)]: {
          ...draftValue,
          updatedAt: Date.now()
        }
      });
    } catch {
      // Uploaded data URLs can exceed storage quota; the visible page edit still remains.
    }
  }

  async function getCurrentDraftValue() {
    const edit = state.edit;
    if (!edit) {
      return { type: "none", value: "" };
    }

    if (edit.type === "content") {
      let value = edit.mode === "html" || edit.mode === "plain"
        ? (edit.element.textContent ?? "")
        : edit.element.innerHTML;

      if (edit.bridgeEditorId) {
        const result = await getVendorEditorData(edit.bridgeEditorId);
        if (result?.ok && typeof result.data === "string") {
          value = result.data;
        }
      }

      return {
        type: "content",
        mode: edit.mode,
        value
      };
    }

    if (edit.type === "form") {
      return { type: "form", value: edit.element.value };
    }

    if (edit.type === "image") {
      return { type: "image", value: captureImageState(edit.element) };
    }

    if (edit.type === "box") {
      return { type: "box", value: edit.element.getAttribute("style") || "" };
    }

    return { type: "page", value: document.body.innerHTML };
  }

  async function loadDraft() {
    if (!state.selectedPath || !state.settings.autosave) {
      return null;
    }

    const result = await chrome.storage.local.get(getDraftKey(state.selectedPath));
    return result[getDraftKey(state.selectedPath)] ?? null;
  }

  async function removeDraftForPath(path) {
    if (path) {
      await chrome.storage.local.remove(getDraftKey(path));
    }
  }

  async function clearDrafts() {
    const allItems = await chrome.storage.local.get(null);
    const keys = Object.keys(allItems).filter((key) => key.startsWith("page-studio-draft:"));
    if (keys.length === 0) {
      return false;
    }

    await chrome.storage.local.remove(keys);
    return true;
  }

  function getDraftKey(path) {
    const pageKey = `${location.origin}${location.pathname}`;
    return `page-studio-draft:${pageKey}:${path}`;
  }

  function applyContentValue(element, mode, value) {
    if (mode === "html") {
      element.textContent = value;
    } else if (mode === "plain") {
      element.textContent = htmlToText(value);
    } else {
      element.innerHTML = value;
    }
  }

  function captureImageState(image) {
    const style = image.style;

    return {
      src: image.getAttribute("src") || image.currentSrc || image.src || "",
      srcAttribute: image.getAttribute("src"),
      srcsetAttribute: image.getAttribute("srcset"),
      sizesAttribute: image.getAttribute("sizes"),
      altAttribute: image.getAttribute("alt"),
      titleAttribute: image.getAttribute("title"),
      widthAttribute: image.getAttribute("width"),
      heightAttribute: image.getAttribute("height"),
      styleText: image.getAttribute("style"),
      width: style.width || attrSizeToCss(image.getAttribute("width")),
      height: style.height || attrSizeToCss(image.getAttribute("height")),
      objectFit: style.objectFit || "",
      borderRadius: style.borderRadius || "",
      opacity: style.opacity || "",
      filter: style.filter || "",
      pictureSources: capturePictureSources(image)
    };
  }

  function applyImageState(image, value) {
    if (!value || typeof value !== "object") {
      return;
    }

    setOptionalAttribute(image, "src", value.src || value.srcAttribute || "");
    restoreNullableAttribute(image, "alt", value.altAttribute);
    restoreNullableAttribute(image, "title", value.titleAttribute);
    restoreNullableAttribute(image, "width", value.widthAttribute);
    restoreNullableAttribute(image, "height", value.heightAttribute);
    if (value.styleText !== null && value.styleText !== undefined) {
      image.setAttribute("style", value.styleText);
    }
    if (value.width) {
      image.style.width = normalizeCssSize(value.width);
    }
    if (value.height) {
      image.style.height = normalizeCssSize(value.height);
    }
    if (value.objectFit) {
      image.style.objectFit = value.objectFit;
    }
    if (value.borderRadius) {
      image.style.borderRadius = normalizeCssSize(value.borderRadius);
    }
    if (value.opacity) {
      image.style.opacity = value.opacity;
    }
    if (value.filter) {
      image.style.filter = value.filter;
    }
  }

  function restoreImageState(image, imageState) {
    if (!imageState) {
      return;
    }

    restoreNullableAttribute(image, "src", imageState.srcAttribute);
    restoreNullableAttribute(image, "srcset", imageState.srcsetAttribute);
    restoreNullableAttribute(image, "sizes", imageState.sizesAttribute);
    restoreNullableAttribute(image, "alt", imageState.altAttribute);
    restoreNullableAttribute(image, "title", imageState.titleAttribute);
    restoreNullableAttribute(image, "width", imageState.widthAttribute);
    restoreNullableAttribute(image, "height", imageState.heightAttribute);
    restorePictureSources(image, imageState.pictureSources);

    if (imageState.styleText === null) {
      image.removeAttribute("style");
    } else {
      image.setAttribute("style", imageState.styleText);
    }
  }

  function capturePictureSources(image) {
    if (!(image.parentElement instanceof HTMLPictureElement)) {
      return [];
    }

    return Array.from(image.parentElement.querySelectorAll("source")).map((source) => {
      return {
        srcset: source.getAttribute("srcset"),
        sizes: source.getAttribute("sizes")
      };
    });
  }

  function clearPictureSources(image) {
    if (!(image.parentElement instanceof HTMLPictureElement)) {
      return;
    }

    for (const source of image.parentElement.querySelectorAll("source")) {
      source.removeAttribute("srcset");
      source.removeAttribute("sizes");
    }
  }

  function restorePictureSources(image, sourceStates) {
    if (!(image.parentElement instanceof HTMLPictureElement) || !Array.isArray(sourceStates)) {
      return;
    }

    const sources = Array.from(image.parentElement.querySelectorAll("source"));
    sourceStates.forEach((sourceState, index) => {
      const source = sources[index];
      if (!source) {
        return;
      }

      restoreNullableAttribute(source, "srcset", sourceState.srcset);
      restoreNullableAttribute(source, "sizes", sourceState.sizes);
    });
  }

  function fireDomUpdate(element) {
    const events = [
      new InputEvent("input", { bubbles: true, inputType: "insertText" }),
      new Event("change", { bubbles: true })
    ];

    for (const event of events) {
      element.dispatchEvent(event);
    }
  }

  function buildCssPath(element) {
    if (!element || element === document.body) {
      return "body";
    }

    const parts = [];
    let node = element;
    while (node && node.nodeType === Node.ELEMENT_NODE && node !== document.body) {
      let selector = node.tagName.toLowerCase();
      if (node.id) {
        selector += `#${cssEscape(node.id)}`;
        parts.unshift(selector);
        break;
      }

      const siblings = Array.from(node.parentElement?.children ?? [])
        .filter((sibling) => sibling.tagName === node.tagName);
      if (siblings.length > 1) {
        selector += `:nth-of-type(${siblings.indexOf(node) + 1})`;
      }

      parts.unshift(selector);
      node = node.parentElement;
    }

    return ["body", ...parts].join(" > ");
  }

  function createEditId() {
    return `page-studio-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function isFormField(element) {
    return element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement ||
      element instanceof HTMLSelectElement;
  }

  function attrSizeToCss(value) {
    if (!value) {
      return "";
    }

    return /^\d+(\.\d+)?$/.test(value) ? `${value}px` : value;
  }

  function normalizeCssSize(value) {
    const trimmed = String(value ?? "").trim();
    if (!trimmed) {
      return "";
    }
    if (/^(auto|inherit|initial|unset)$/i.test(trimmed)) {
      return trimmed.toLowerCase();
    }
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
      return `${trimmed}px`;
    }
    return trimmed;
  }

  function cssEscape(value) {
    if (window.CSS?.escape) {
      return window.CSS.escape(value);
    }

    return value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }

  function sanitizeHTML(html) {
    const template = document.createElement("template");
    template.innerHTML = html;

    template.content.querySelectorAll("script, object, embed").forEach((node) => node.remove());
    template.content.querySelectorAll("*").forEach((node) => {
      for (const attribute of Array.from(node.attributes)) {
        const name = attribute.name.toLowerCase();
        const value = attribute.value.trim().toLowerCase();
        if (name.startsWith("on") || value.startsWith("javascript:")) {
          node.removeAttribute(attribute.name);
        }
      }
    });

    return template.innerHTML;
  }

  function htmlToText(html) {
    const template = document.createElement("template");
    template.innerHTML = html;
    return template.content.textContent ?? "";
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function setOptionalAttribute(element, name, value) {
    const trimmed = String(value ?? "").trim();
    if (trimmed) {
      element.setAttribute(name, trimmed);
    } else {
      element.removeAttribute(name);
    }
  }

  function restoreNullableAttribute(element, name, value) {
    if (value === null || value === undefined) {
      element.removeAttribute(name);
    } else {
      element.setAttribute(name, value);
    }
  }

  function captureDocumentSnapshot() {
    const htmlClone = document.documentElement.cloneNode(true);
    removePageStudioArtifacts(htmlClone);

    const head = htmlClone.querySelector("head");
    const body = htmlClone.querySelector("body");
    const doctype = serializeDoctype(document.doctype);
    const outerHtml = htmlClone.outerHTML;

    return {
      ok: true,
      title: document.title || location.hostname || "Untitled page",
      url: location.href,
      origin: location.origin,
      baseUrl: document.baseURI,
      capturedAt: new Date().toISOString(),
      doctype,
      headHtml: head?.innerHTML || "",
      bodyHtml: body?.innerHTML || "",
      htmlAttributes: serializeAttributes(htmlClone),
      bodyAttributes: body ? serializeAttributes(body) : "",
      fullHtml: `${doctype}\n${outerHtml}`
    };
  }

  function replaceDocumentFromHtml(html) {
    document.open();
    document.write(String(html || ""));
    document.close();
  }

  function removePageStudioArtifacts(root) {
    root.querySelectorAll("#page-studio-root, #page-studio-global-style, [data-page-studio-ui='true']").forEach((node) => {
      node.remove();
    });

    root.querySelectorAll("[data-page-studio-editing], [data-page-studio-edit-id], [data-page-studio-editor]").forEach((element) => {
      element.removeAttribute("data-page-studio-editing");
      element.removeAttribute("data-page-studio-edit-id");
      element.removeAttribute("data-page-studio-editor");
      element.classList.remove("page-studio-hover-outline", "page-studio-editing-outline");
      if (element.getAttribute("class") === "") {
        element.removeAttribute("class");
      }
    });
  }

  function serializeDoctype(doctype) {
    if (!doctype) {
      return "<!doctype html>";
    }

    let value = `<!doctype ${doctype.name}`;
    if (doctype.publicId) {
      value += ` PUBLIC "${doctype.publicId}"`;
    }
    if (doctype.systemId) {
      value += doctype.publicId ? ` "${doctype.systemId}"` : ` SYSTEM "${doctype.systemId}"`;
    }
    return `${value}>`;
  }

  function serializeAttributes(element) {
    return Array.from(element.attributes)
      .map((attribute) => `${attribute.name}="${escapeHtml(attribute.value)}"`)
      .join(" ");
  }

  const GLOBAL_CSS = `
    .page-studio-hover-outline {
      outline: 2px solid #0d9276 !important;
      outline-offset: 2px !important;
      cursor: cell !important;
    }

    .page-studio-editing-outline {
      outline: 2px solid #e16735 !important;
      outline-offset: 3px !important;
    }

    [data-page-studio-editing="true"] {
      min-height: 1em !important;
    }

    [data-page-studio-editing="true"][contenteditable="true"],
    [data-page-studio-editing="true"][contenteditable="plaintext-only"] {
      cursor: text !important;
    }

    [data-page-studio-editor="html"] {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace !important;
      white-space: pre-wrap !important;
    }

    [data-page-studio-ui="true"] {
      position: fixed !important;
      inset: 0 auto auto 0 !important;
      z-index: 2147483647 !important;
    }
  `;

  const SHADOW_CSS = `
    :host {
      all: initial;
      color-scheme: light;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    .editor-overlay {
      background: #172027;
      border: 1px solid rgb(255 255 255 / 14%);
      border-radius: 8px;
      box-shadow: 0 14px 34px rgb(21 28 36 / 28%);
      color: #ffffff;
      left: 0;
      max-width: calc(100vw - 16px);
      min-width: 280px;
      pointer-events: auto;
      position: fixed;
      top: 0;
      z-index: 2;
    }

    .editor-overlay::before {
      background: #e16735;
      border-radius: 999px;
      content: "";
      height: 3px;
      left: 10px;
      position: absolute;
      right: 10px;
      top: -2px;
    }

    .overlay-row {
      align-items: center;
      display: flex;
      gap: 6px;
      min-height: 38px;
      overflow-x: auto;
      padding: 5px 6px;
      scrollbar-width: none;
      white-space: nowrap;
    }

    .overlay-row::-webkit-scrollbar {
      display: none;
    }

    .overlay-label {
      color: #dce7ec;
      flex: 0 0 auto;
      font-size: 12px;
      font-weight: 800;
      line-height: 1;
      max-width: 160px;
      overflow: hidden;
      padding: 0 6px;
      text-overflow: ellipsis;
    }

    .overlay-divider {
      background: rgb(255 255 255 / 18%);
      flex: 0 0 auto;
      height: 22px;
      width: 1px;
    }

    .overlay-spacer {
      flex: 1 1 auto;
      min-width: 6px;
    }

    .overlay-button {
      align-items: center;
      background: rgb(255 255 255 / 9%);
      border: 0;
      border-radius: 6px;
      color: #ffffff;
      cursor: pointer;
      display: inline-flex;
      flex: 0 0 auto;
      font: inherit;
      font-size: 12px;
      font-weight: 800;
      height: 28px;
      justify-content: center;
      min-width: 28px;
      padding: 0 8px;
    }

    .overlay-button:hover {
      background: rgb(255 255 255 / 17%);
    }

    .overlay-cancel {
      background: rgb(255 255 255 / 7%);
      color: #dce7ec;
    }

    .overlay-done {
      background: #0d9276;
      color: #ffffff;
    }

    .overlay-done:hover {
      background: #0a7f66;
    }

    .image-overlay {
      border: 1px solid #e16735;
      box-shadow: 0 0 0 1px rgb(225 103 53 / 22%);
      left: 0;
      min-height: 24px;
      min-width: 24px;
      pointer-events: none;
      position: fixed;
      top: 0;
      z-index: 1;
    }

    .image-handle {
      background: #ffffff;
      border: 2px solid #e16735;
      border-radius: 999px;
      box-shadow: 0 2px 6px rgb(21 28 36 / 24%);
      height: 12px;
      pointer-events: auto;
      position: absolute;
      width: 12px;
    }

    .image-handle-nw {
      cursor: nwse-resize;
      left: -7px;
      top: -7px;
    }

    .image-handle-ne {
      cursor: nesw-resize;
      right: -7px;
      top: -7px;
    }

    .image-handle-se {
      bottom: -7px;
      cursor: nwse-resize;
      right: -7px;
    }

    .image-handle-sw {
      bottom: -7px;
      cursor: nesw-resize;
      left: -7px;
    }

    .hidden-file-input {
      height: 1px;
      left: -9999px;
      opacity: 0;
      pointer-events: none;
      position: fixed;
      top: -9999px;
      width: 1px;
    }
  `;
})();
