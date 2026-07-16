// Editor types that have been removed from the extension. Notes created with
// them are purged from history so they never appear again.
const PURGED_NOTE_TYPES = ["aloha", "jce", "ckeditor", "jck"];

chrome.runtime.onInstalled.addListener(purgeRemovedEditorNotes);
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
