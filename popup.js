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
