(() => {
  if (window.__pageStudioEditorBridge) {
    return;
  }
  window.__pageStudioEditorBridge = true;

  const editors = new Map();
  let nextEditorId = 0;

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.data?.source !== "PAGE_STUDIO_CONTENT") {
      return;
    }

    void handleCommand(event.data);
  });

  async function handleCommand(message) {
    try {
      if (message.command === "START_EDITOR") {
        const result = await startEditor(message);
        reply(message.id, result);
        return;
      }

      if (message.command === "STOP_EDITOR") {
        const result = await stopEditor(message);
        reply(message.id, result);
        return;
      }

      if (message.command === "GET_DATA") {
        const result = getEditorData(message);
        reply(message.id, result);
        return;
      }

      if (message.command === "RUN_COMMAND") {
        const result = runEditorCommand(message);
        reply(message.id, result);
        return;
      }

      reply(message.id, { ok: false, reason: "unknown-command" });
    } catch (error) {
      reply(message.id, {
        ok: false,
        reason: "bridge-error",
        error: String(error?.message || error)
      });
    }
  }

  async function startEditor(message) {
    const element = document.querySelector(message.selector);
    if (!element) {
      return { ok: false, reason: "missing-element" };
    }

    if (message.editor === "tinymce") {
      return startTinyMce(element, message);
    }

    if (message.editor === "ckeditor") {
      return startCkEditor(element, message);
    }

    if (message.editor === "aloha") {
      return startAloha(element, message);
    }

    if (message.editor === "tiptap") {
      return startTiptap(element, message);
    }

    return { ok: false, reason: "unsupported-editor" };
  }

  async function startTinyMce(element, message) {
    if (!window.tinymce) {
      await loadScript(message.scriptUrl);
    }

    if (!window.tinymce) {
      return { ok: false, reason: "tinymce-unavailable" };
    }

    const editorId = createEditorId("tinymce");
    const [editor] = await window.tinymce.init({
      target: element,
      inline: true,
      menubar: false,
      branding: false,
      promotion: false,
      license_key: "gpl",
      base_url: message.baseUrl,
      suffix: ".min",
      plugins: "lists link image table code",
      toolbar: "undo redo | blocks | bold italic underline | alignleft aligncenter alignright | bullist numlist | link image table | code",
      setup(editor) {
        editor.on("input change keyup undo redo", () => {
          element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
        });
      }
    });

    editors.set(editorId, {
      type: "tinymce",
      element,
      instance: editor
    });

    return { ok: true, editorId };
  }

  async function startCkEditor(element, message) {
    if (!window.InlineEditor && !window.CKEDITOR) {
      await loadScript(message.scriptUrl);
    }

    if (window.InlineEditor?.create) {
      const editor = await window.InlineEditor.create(element, {
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
      const editorId = createEditorId("ckeditor5");
      editors.set(editorId, {
        type: "ckeditor5",
        element,
        instance: editor
      });
      editor.model.document.on("change:data", () => {
        element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
      });
      return { ok: true, editorId };
    }

    if (window.CKEDITOR?.inline) {
      element.setAttribute("contenteditable", "true");
      const editor = window.CKEDITOR.inline(element);
      const editorId = createEditorId("ckeditor4");
      editors.set(editorId, {
        type: "ckeditor4",
        element,
        instance: editor
      });
      editor.on("change", () => {
        element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
      });
      return { ok: true, editorId };
    }

    return { ok: false, reason: "ckeditor-unavailable" };
  }

  async function startAloha(element, message) {
    if (!window.Aloha) {
      await loadScript(message.scriptUrl);
    }

    if (!window.Aloha) {
      return { ok: false, reason: "aloha-unavailable" };
    }

    const editorId = createEditorId("aloha");
    element.classList.add("aloha-editable");
    await new Promise((resolve) => {
      if (typeof window.Aloha.ready === "function") {
        window.Aloha.ready(resolve);
      } else {
        resolve();
      }
    });

    const alohaJquery = window.Aloha.jQuery || window.jQuery;
    if (alohaJquery?.fn?.aloha) {
      alohaJquery(element).aloha();
      editors.set(editorId, {
        type: "aloha",
        element,
        instance: alohaJquery(element),
        jquery: alohaJquery
      });
      return { ok: true, editorId };
    }

    return { ok: false, reason: "aloha-jquery-unavailable" };
  }

  async function startTiptap(element, message) {
    if (!window.PageStudioTiptap) {
      await loadScript(message.scriptUrl);
    }

    if (!window.PageStudioTiptap?.create) {
      return { ok: false, reason: "tiptap-unavailable" };
    }

    const editorId = createEditorId("tiptap");
    const temporaryContentEditable = element.getAttribute("contenteditable");
    element.removeAttribute("contenteditable");
    let editor;
    try {
      editor = window.PageStudioTiptap.create(element);
    } catch (error) {
      restoreNullableAttribute(element, "contenteditable", temporaryContentEditable);
      throw error;
    }
    editors.set(editorId, {
      type: "tiptap",
      element,
      instance: editor
    });
    return { ok: true, editorId };
  }

  async function stopEditor(message) {
    const record = editors.get(message.editorId);
    if (!record) {
      return { ok: false, reason: "missing-editor" };
    }

    let data = getRecordData(record);

    if (record.type === "tinymce") {
      record.instance.remove();
      if (message.commit) {
        record.element.innerHTML = data;
      }
    } else if (record.type === "ckeditor5") {
      await record.instance.destroy();
      if (message.commit) {
        record.element.innerHTML = data;
      }
    } else if (record.type === "ckeditor4") {
      record.instance.destroy();
      if (message.commit) {
        record.element.innerHTML = data;
      }
    } else if (record.type === "aloha") {
      if (record.jquery?.fn?.mahalo) {
        record.jquery(record.element).mahalo();
      }
      record.element.classList.remove("aloha-editable");
    } else if (record.type === "tiptap") {
      data = record.instance.destroy();
      if (message.commit) {
        record.element.innerHTML = data;
      }
    }

    editors.delete(message.editorId);
    return { ok: true, data };
  }

  function getEditorData(message) {
    const record = editors.get(message.editorId);
    if (!record) {
      return { ok: false, reason: "missing-editor" };
    }

    return { ok: true, data: getRecordData(record) };
  }

  function runEditorCommand(message) {
    const record = editors.get(message.editorId);
    if (!record) {
      return { ok: false, reason: "missing-editor" };
    }

    if (record.type === "tiptap" && typeof record.instance.runCommand === "function") {
      return {
        ok: Boolean(record.instance.runCommand(message.commandName, message.value)),
        data: getRecordData(record)
      };
    }

    return { ok: false, reason: "unsupported-command" };
  }

  function getRecordData(record) {
    if (record.type === "tinymce") {
      return record.instance.getContent();
    }

    if (record.type === "ckeditor5" || record.type === "ckeditor4") {
      return record.instance.getData();
    }

    if (record.type === "tiptap" && typeof record.instance.getHTML === "function") {
      return record.instance.getHTML();
    }

    return record.element.innerHTML;
  }

  function createEditorId(prefix) {
    nextEditorId += 1;
    return `page-studio-${prefix}-${Date.now()}-${nextEditorId}`;
  }

  function restoreNullableAttribute(element, name, value) {
    if (value === null) {
      element.removeAttribute(name);
      return;
    }

    element.setAttribute(name, value);
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (!src) {
        reject(new Error("missing script url"));
        return;
      }

      const existing = Array.from(document.scripts).find((script) => script.src === src);
      if (existing) {
        existing.addEventListener("load", resolve, { once: true });
        existing.addEventListener("error", reject, { once: true });
        if (existing.dataset.loaded === "true") {
          resolve();
        }
        return;
      }

      const script = document.createElement("script");
      script.src = src;
      script.async = false;
      script.dataset.pageStudioVendor = "true";
      script.addEventListener("load", () => {
        script.dataset.loaded = "true";
        resolve();
      }, { once: true });
      script.addEventListener("error", () => {
        reject(new Error(`Unable to load ${src}`));
      }, { once: true });
      (document.head || document.documentElement).appendChild(script);
    });
  }

  function reply(id, payload) {
    window.postMessage({
      source: "PAGE_STUDIO_BRIDGE",
      id,
      ...payload
    }, "*");
  }

})();
