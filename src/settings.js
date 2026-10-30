const SETTINGS_KEY = "notepadSettings";
const DEFAULTS = { defaultEditor: "", wordDefaultZoom: 1, confirmDelete: true, showLinkHistory: true };
const controls = {
  defaultEditor: document.querySelector("#defaultEditor"),
  wordDefaultZoom: document.querySelector("#wordDefaultZoom"),
  confirmDelete: document.querySelector("#confirmDelete"),
  showLinkHistory: document.querySelector("#showLinkHistory")
};
const saveStatus = document.querySelector("#saveStatus");
const backupStatus = document.querySelector("#backupStatus");
const exportButton = document.querySelector("#exportBackupButton");
const restoreButton = document.querySelector("#restoreBackupButton");
const restoreInput = document.querySelector("#restoreBackupInput");

init();

async function init() {
  document.querySelector("#versionLabel").textContent = `v${chrome.runtime.getManifest().version}`;
  document.querySelector("#closeButton").addEventListener("click", () => window.close());
  document.querySelector("#resetButton").addEventListener("click", resetSettings);
  exportButton.addEventListener("click", exportFullBackup);
  restoreButton.addEventListener("click", () => restoreInput.click());
  restoreInput.addEventListener("change", restoreFullBackup);
  Object.values(controls).forEach((control) => control.addEventListener("change", saveSettings));
  await loadSettings();
}

async function loadSettings() {
  const data = await chrome.storage.local.get(SETTINGS_KEY);
  const settings = { ...DEFAULTS, ...(data[SETTINGS_KEY] || {}) };
  controls.defaultEditor.value = settings.defaultEditor;
  controls.wordDefaultZoom.value = String(settings.wordDefaultZoom);
  controls.confirmDelete.checked = settings.confirmDelete;
  controls.showLinkHistory.checked = settings.showLinkHistory;
}

async function saveSettings() {
  await chrome.storage.local.set({ [SETTINGS_KEY]: {
    defaultEditor: controls.defaultEditor.value,
    wordDefaultZoom: Number(controls.wordDefaultZoom.value),
    confirmDelete: controls.confirmDelete.checked,
    showLinkHistory: controls.showLinkHistory.checked
  } });
  saveStatus.textContent = "Saved.";
  setTimeout(() => { saveStatus.textContent = "Settings are saved automatically."; }, 1400);
}

async function resetSettings() {
  if (!window.confirm("Reset preferences to their defaults? Your notes will not be changed.")) return;
  await chrome.storage.local.set({ [SETTINGS_KEY]: { ...DEFAULTS } });
  await loadSettings();
  saveStatus.textContent = "Settings reset.";
}

async function exportFullBackup() {
  setBusy(true); showBackup("Preparing backup…");
  try {
    const data = await chrome.storage.local.get(null);
    const serialized = JSON.stringify(data);
    const backup = {
      format: "notepad-library-backup", schemaVersion: 1,
      extensionVersion: chrome.runtime.getManifest().version,
      exportedAt: new Date().toISOString(), checksum: await sha256(serialized), data
    };
    download(new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }), `notepad-library-backup-${new Date().toISOString().slice(0, 10)}.json`);
    showBackup(`Backup saved with ${Array.isArray(data.notepadHistory) ? data.notepadHistory.length : 0} notes.`);
  } catch (error) { console.error(error); showBackup("The backup could not be created.", true); }
  finally { setBusy(false); }
}

async function restoreFullBackup() {
  const file = restoreInput.files?.[0]; restoreInput.value = "";
  if (!file) return;
  if (file.size > 100 * 1024 * 1024) return showBackup("This backup exceeds the 100 MB limit.", true);
  setBusy(true); showBackup("Checking backup…");
  try {
    const backup = JSON.parse(await file.text());
    if (backup?.format !== "notepad-library-backup" || backup.schemaVersion !== 1 || !backup.data || Array.isArray(backup.data)) throw new Error("invalid");
    if (backup.checksum && await sha256(JSON.stringify(backup.data)) !== backup.checksum) throw new Error("checksum");
    const notes = Array.isArray(backup.data.notepadHistory) ? backup.data.notepadHistory.length : 0;
    if (!window.confirm(`Restore ${notes} notes? This replaces all data currently stored in Notepad Library.`)) return showBackup("Restore cancelled.");
    const safeData = Object.fromEntries(Object.entries(backup.data).filter(([key]) => !["__proto__", "prototype", "constructor"].includes(key)));
    await chrome.storage.local.clear();
    if (Object.keys(safeData).length) await chrome.storage.local.set(safeData);
    await loadSettings(); showBackup(`Restore complete: ${notes} notes recovered.`);
  } catch (error) { console.error(error); showBackup(error.message === "checksum" ? "The backup is damaged or was modified." : "This is not a valid Notepad Library backup.", true); }
  finally { setBusy(false); }
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
function download(blob, filename) { const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1500); }
function setBusy(value) { exportButton.disabled = value; restoreButton.disabled = value; }
function showBackup(message, error = false) { backupStatus.hidden = false; backupStatus.textContent = message; backupStatus.classList.toggle("error", error); }
