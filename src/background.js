const DEFAULT_SETTINGS = {
  editor: "native",
  autosave: true,
  showOutlines: true,
  sanitizeHtml: true
};

// Editor types that have been removed from the extension. Notes created with
// them are purged from history so they never appear again.
const PURGED_NOTE_TYPES = ["aloha", "jce"];

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get(DEFAULT_SETTINGS, (settings) => {
    chrome.storage.sync.set({ ...DEFAULT_SETTINGS, ...settings });
  });
  purgeRemovedEditorNotes();
});

chrome.runtime.onStartup.addListener(purgeRemovedEditorNotes);

async function purgeRemovedEditorNotes() {
  const { notepadHistory } = await chrome.storage.local.get("notepadHistory");
  if (!Array.isArray(notepadHistory)) {
    return;
  }
  const cleaned = notepadHistory.filter((note) => !PURGED_NOTE_TYPES.includes(note?.type));
  if (cleaned.length !== notepadHistory.length) {
    await chrome.storage.local.set({ notepadHistory: cleaned });
  }
}

chrome.commands.onCommand.addListener((command) => {
  if (command !== "toggle-editor") {
    return;
  }

  sendToActiveTab({ type: "PAGE_STUDIO_TOGGLE" });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "PAGE_STUDIO_OPEN_CK_FULL_PAGE") {
    openFullPageCkEditor()
      .then((response) => sendResponse(response))
      .catch((error) => {
        sendResponse({
          ok: false,
          error: String(error?.message || error)
        });
      });
    return true;
  }

  if (message?.type === "PAGE_STUDIO_APPLY_FULL_PAGE") {
    applyFullPageToSourceTab(message)
      .then((response) => sendResponse(response))
      .catch((error) => {
        sendResponse({
          ok: false,
          error: String(error?.message || error)
        });
      });
    return true;
  }

  return false;
});

async function sendToActiveTab(message) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    return;
  }

  try {
    await chrome.tabs.sendMessage(tab.id, message);
  } catch (error) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["src/content.js"]
      });
      await chrome.tabs.sendMessage(tab.id, message);
    } catch {
      // Chrome pages and the Web Store do not allow extension injection.
    }
  }
}

async function openFullPageCkEditor() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    return { ok: false, error: "No active tab found." };
  }

  const snapshot = await captureActiveTab(tab.id);
  if (!snapshot?.ok) {
    return {
      ok: false,
      error: snapshot?.error || "Unable to capture this page."
    };
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

  return { ok: true, snapshotId };
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
        error: "Chrome does not allow this page to be captured by extensions."
      };
    }
  }
}

async function applyFullPageToSourceTab(message) {
  if (!message?.sourceTabId || !message?.html) {
    return { ok: false, error: "Missing source tab or HTML." };
  }

  try {
    await chrome.tabs.sendMessage(message.sourceTabId, {
      type: "PAGE_STUDIO_REPLACE_DOCUMENT",
      html: message.html
    });
    return { ok: true };
  } catch {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: message.sourceTabId },
        files: ["src/content.js"]
      });
      await chrome.tabs.sendMessage(message.sourceTabId, {
        type: "PAGE_STUDIO_REPLACE_DOCUMENT",
        html: message.html
      });
      return { ok: true };
    } catch {
      return {
        ok: false,
        error: "The source tab is no longer available or cannot be edited."
      };
    }
  }
}
