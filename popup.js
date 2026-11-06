"use strict";
const toggle = document.querySelector("#enabled");
const status = document.querySelector("#status");

function render(enabled) {
  toggle.checked = enabled;
  status.textContent = enabled ? "On for arXiv HTML papers." : "Off. Citations jump to the bibliography.";
}

chrome.storage.local.get({ enabled: true }).then(settings => {
  render(settings.enabled !== false);
  toggle.disabled = false;
}).catch(() => { status.textContent = "Couldn't load the setting. Reopen to try again."; });

toggle.addEventListener("change", async () => {
  const enabled = toggle.checked;
  toggle.disabled = true;
  try {
    await chrome.storage.local.set({ enabled });
    render(enabled);
  } catch {
    render(!enabled);
    status.textContent = "Couldn't save the setting. Please try again.";
  } finally {
    toggle.disabled = false;
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.enabled) render(changes.enabled.newValue !== false);
});
