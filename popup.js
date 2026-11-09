"use strict";
const toggle = document.querySelector("#enabled");
const destination = document.querySelector("#destination");
const status = document.querySelector("#status");
const settings = { enabled: true, destination: "html" };

function render() {
  toggle.checked = settings.enabled !== false;
  destination.value = ["html", "pdf", "abstract"].includes(settings.destination) ? settings.destination : "html";
  status.textContent = toggle.checked ? "On for arXiv HTML papers." : "Off. Citations jump to the bibliography.";
}

function setBusy(busy) {
  toggle.disabled = busy;
  destination.disabled = busy;
}

chrome.storage.local.get(settings).then(saved => {
  Object.assign(settings, saved);
  render();
  setBusy(false);
}).catch(() => { status.textContent = "Couldn't load the setting. Reopen to try again."; });

async function saveSetting(key, value) {
  setBusy(true);
  try {
    await chrome.storage.local.set({ [key]: value });
    settings[key] = value;
    render();
  } catch {
    render();
    status.textContent = "Couldn't save the setting. Please try again.";
  } finally {
    setBusy(false);
  }
}

toggle.addEventListener("change", () => saveSetting("enabled", toggle.checked));
destination.addEventListener("change", () => saveSetting("destination", destination.value));

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  for (const key of ["enabled", "destination"]) {
    if (changes[key]) settings[key] = changes[key].newValue;
  }
  render();
});

const { defaults: downloadDefaults, relativeFolder, folderRecord } = globalThis.ArxivHopDownloads;
const downloadFields = document.querySelector("#download-settings");
const downloadFolder = document.querySelector("#download-folder");
const downloadNaming = document.querySelector("#download-naming");
const downloadStatus = document.querySelector("#download-status");
const chooseFolder = document.querySelector("#choose-folder");
const reconnectFolder = document.querySelector("#reconnect-folder");
const resetFolder = document.querySelector("#reset-folder");
const folderAccessHelp = document.querySelector("#folder-access-help");
const folderPage = new URLSearchParams(location.search).has("folder");
let directory;
let previousSubfolder = "";

if (folderPage) {
  document.body.classList.add("folder-page");
  document.querySelector(".downloads").open = true;
}

async function renderFolder() {
  downloadFolder.textContent = directory?.name || previousSubfolder || "Downloads (default)";
  resetFolder.hidden = !directory && !previousSubfolder;
  reconnectFolder.hidden = !directory || await directory.queryPermission({ mode: "readwrite" }) === "granted";
  folderAccessHelp.hidden = !folderPage || reconnectFolder.hidden;
}

Promise.all([chrome.storage.local.get(downloadDefaults), folderRecord()]).then(async ([saved, handle]) => {
  directory = handle;
  previousSubfolder = relativeFolder(saved.downloadFolder) || "";
  downloadNaming.value = saved.downloadNaming === "id" ? "id" : "title";
  await renderFolder();
  downloadFields.disabled = false;
}).catch(() => { downloadStatus.textContent = "Couldn't load download settings. Reopen to try again."; });

async function updateDownloads(update) {
  downloadFields.disabled = true;
  downloadStatus.textContent = "";
  try {
    await update();
    await renderFolder();
  } catch (error) {
    if (error.name !== "AbortError") downloadStatus.textContent = "Couldn't update download settings. Please try again.";
  } finally {
    downloadFields.disabled = false;
  }
}

chooseFolder.addEventListener("click", () => updateDownloads(async () => {
  const handle = await window.showDirectoryPicker({ mode: "readwrite", startIn: directory || "downloads" });
  await folderRecord(handle);
  directory = handle;
  downloadStatus.textContent = "Folder saved. Reopen the popup to reconnect if needed.";
}));

reconnectFolder.addEventListener("click", () => {
  if (!folderPage) {
    // A browser tab can show the persistent access prompt.
    return updateDownloads(() => chrome.tabs.create({ url: chrome.runtime.getURL("popup.html?folder") }));
  }
  return updateDownloads(async () => {
    const permission = await directory.requestPermission({ mode: "readwrite" });
    downloadStatus.textContent = permission === "granted" ? "Folder reconnected." : "Allow access to save PDFs here.";
  });
});

resetFolder.addEventListener("click", () => updateDownloads(async () => {
  await chrome.storage.local.set({ downloadFolder: "" });
  previousSubfolder = "";
  await folderRecord(null);
  directory = null;
}));

downloadNaming.addEventListener("change", () => updateDownloads(async () => {
  await chrome.storage.local.set({ downloadNaming: downloadNaming.value });
}));
