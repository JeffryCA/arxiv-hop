/* Shared filename and folder settings for the popup and the download worker. */
(() => {
  "use strict";
  const defaults = { downloadFolder: "", downloadNaming: "title" };
  const invalid = /[<>:"/\\|?*\x00-\x1f\x7f]/;
  const reserved = /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i;
  const encoder = new TextEncoder();

  function safeSegment(value) {
    return value && !invalid.test(value) && !reserved.test(value)
      && !value.endsWith(".") && encoder.encode(value).length <= 240;
  }

  function relativeFolder(value) {
    if (typeof value !== "string") return null;
    const folder = value.trim();
    if (!folder) return "";
    const segments = folder.split("/").map(segment => segment.trim());
    if (encoder.encode(folder).length > 240 || !segments.every(safeSegment)) return null;
    return segments.join("/");
  }

  function filename(id, title, settings) {
    let stem = id.replace("/", "-");
    if (settings.downloadNaming !== "id" && typeof title === "string") {
      const candidate = title.replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, " ")
        .replace(/\s+/g, " ").replace(/^[. ]+|[. ]+$/g, "");
      if (safeSegment(candidate)) stem = candidate;
    }
    const folder = relativeFolder(settings.downloadFolder);
    return folder ? `${folder}/${stem}.pdf` : `${stem}.pdf`;
  }

  // Directory handles can be saved in IndexedDB and shared with the worker.
  function folderRecord(handle) {
    return new Promise((resolve, reject) => {
      const open = indexedDB.open("arxiv-hop-downloads", 1);
      open.onupgradeneeded = () => open.result.createObjectStore("settings");
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const database = open.result;
        const transaction = database.transaction("settings", handle === undefined ? "readonly" : "readwrite");
        const settings = transaction.objectStore("settings");
        let operation;
        if (handle === undefined) operation = settings.get("folder");
        else if (handle === null) operation = settings.delete("folder");
        else operation = settings.put(handle, "folder");
        transaction.oncomplete = () => {
          database.close();
          resolve(operation.result ?? null);
        };
        transaction.onabort = () => {
          database.close();
          reject(transaction.error);
        };
      };
    });
  }

  const api = { defaults, relativeFolder, filename, folderRecord };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else globalThis.ArxivHopDownloads = api;
})();
