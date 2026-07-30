// Editor types that have been removed from the extension. Notes created with
// them are purged from history so they never appear again.
const PURGED_NOTE_TYPES = ["aloha", "jce", "ckeditor", "jck"];
const LINK_HISTORY_KEY = "notepadLinkHistory";
const LINK_HISTORY_LIMIT = 100;
const DIRECT_TRANSITIONS = new Set(["typed", "auto_bookmark"]);

chrome.runtime.onInstalled.addListener(cleanStoredHistory);
chrome.runtime.onStartup.addListener(cleanStoredHistory);

if (chrome.webNavigation?.onCommitted) {
  chrome.webNavigation.onCommitted.addListener(trackDirectNavigation, {
    url: [{ schemes: ["http", "https"] }]
  });
}

async function cleanStoredHistory() {
  await purgeRemovedEditorNotes();
  await purgeUnsupportedLinkHistory();
}

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

async function purgeUnsupportedLinkHistory() {
  const data = await chrome.storage.local.get(LINK_HISTORY_KEY);
  const history = Array.isArray(data[LINK_HISTORY_KEY]) ? data[LINK_HISTORY_KEY] : [];
  const cleaned = filterSupportedLinkHistory(history);
  if (cleaned.length !== history.length) {
    await chrome.storage.local.set({ [LINK_HISTORY_KEY]: cleaned });
  }
}

async function trackDirectNavigation(details) {
  if (details.frameId !== 0 || !DIRECT_TRANSITIONS.has(details.transitionType)) {
    return;
  }

  const entry = createHistoryEntry(details.url);
  if (!entry) {
    return;
  }

  const data = await chrome.storage.local.get(LINK_HISTORY_KEY);
  const history = filterSupportedLinkHistory(data[LINK_HISTORY_KEY]);
  const previous = history.find((item) => item.url === entry.url);
  const nextEntry = {
    ...previous,
    ...entry,
    openedAt: Date.now(),
    openCount: (previous?.openCount || 0) + 1
  };
  const nextHistory = [
    nextEntry,
    ...history.filter((item) => item.url !== entry.url)
  ].slice(0, LINK_HISTORY_LIMIT);

  await chrome.storage.local.set({ [LINK_HISTORY_KEY]: nextHistory });
}

function createHistoryEntry(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    return null;
  }

  if (!onlineNotepadHost(url.hostname)) {
    return null;
  }

  return {
    id: historyId(url.href),
    type: "notepad-link",
    url: url.href,
    host: url.hostname,
    title: titleFromUrl(url)
  };
}

function filterSupportedLinkHistory(history) {
  return (Array.isArray(history) ? history : []).filter((item) => {
    try {
      return item?.url && onlineNotepadHost(new URL(item.url).hostname);
    } catch {
      return false;
    }
  });
}

function onlineNotepadHost(hostname) {
  return hostname === "notepad.pw" || hostname === "notepad.cc";
}

function titleFromUrl(url) {
  const slug = decodeURIComponent(url.pathname.replace(/^\/+|\/+$/g, ""));
  if (onlineNotepadHost(url.hostname)) {
    return slug ? `${url.hostname}/${slug}` : url.hostname;
  }
  return url.pathname && url.pathname !== "/"
    ? `${url.hostname}${url.pathname}`
    : url.hostname;
}

function historyId(url) {
  let hash = 0;
  for (let index = 0; index < url.length; index += 1) {
    hash = ((hash << 5) - hash + url.charCodeAt(index)) | 0;
  }
  return `history-${Math.abs(hash)}`;
}
