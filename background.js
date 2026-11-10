/* Handles PDF downloads and on-demand citation lookups. */
importScripts("resolver.js", "downloads.js");
const { arxivID, normalizeTitle, titleQuery } = globalThis.ArxivHopResolver;
const { defaults: downloadDefaults, filename, folderRecord } = globalThis.ArxivHopDownloads;
const CACHE = "titleLookupCacheV1";
const LAST = "titleLookupLastRequest";
const DAY = 86400000;
const pending = new Map();
let lookupQueue = Promise.resolve();
let folderSaveQueue = Promise.resolve();

async function saveToFolder(folder, url, id, title, settings) {
  if (await folder.queryPermission({ mode: "readwrite" }) !== "granted") {
    return { error: "Reconnect your download folder in arXiv Hop." };
  }

  const name = filename(id, title, settings);
  const titleName = filename(id, title, { downloadNaming: "title" });
  const titleStem = titleName.slice(0, -4).normalize().toLowerCase();
  const idStem = id.replace("/", "-").replace(/v\d+$/, "").toLowerCase();
  // Count other versions of the paper and numbered copies as duplicates.
  for await (const entry of folder.values()) {
    if (entry.kind !== "file" || !/\.pdf$/i.test(entry.name)) continue;
    const stem = entry.name.slice(0, -4).normalize().toLowerCase();
    const baseStem = stem.replace(/ \(\d+\)$/, "");
    if (stem !== titleStem && baseStem !== titleStem && baseStem.replace(/v\d+$/, "") !== idStem) continue;
    const existing = await entry.getFile();
    if (await existing.slice(0, 5).text() === "%PDF-") return { alreadySaved: true };
  }

  const response = await fetch(url, { credentials: "omit", signal: AbortSignal.timeout(60000) });
  const type = response.headers.get("content-type")?.split(";")[0];
  if (!response.ok || type !== "application/pdf") throw new Error("PDF unavailable");
  const pdf = await response.blob();

  const stem = name.slice(0, -4);
  for (let index = 0; ; index++) {
    const candidate = index ? `${stem} (${index}).pdf` : name;
    try {
      await folder.getFileHandle(candidate);
    } catch (error) {
      if (error.name === "TypeMismatchError") continue;
      if (error.name !== "NotFoundError") throw error;
      const file = await folder.getFileHandle(candidate, { create: true });
      await pdf.stream().pipeTo(await file.createWritable({ mode: "exclusive" }));
      return { started: true };
    }
  }
}

async function downloadPaper(id, title) {
  const [settings, folder] = await Promise.all([
    chrome.storage.local.get(downloadDefaults),
    folderRecord()
  ]);
  const url = `https://arxiv.org/pdf/${id}`;
  if (folder) {
    const save = folderSaveQueue.then(() => saveToFolder(folder, url, id, title, {
      downloadNaming: settings.downloadNaming
    }));
    folderSaveQueue = save.catch(() => {});
    return save;
  }
  await chrome.downloads.download({
    url, filename: filename(id, title, settings), saveAs: false, conflictAction: "uniquify"
  });
  return { started: true };
}

async function lookup(title) {
  const key = normalizeTitle(title);
  const saved = await chrome.storage.local.get([CACHE, LAST]);
  const cache = saved[CACHE] || {};
  if (cache[key] && Date.now() - cache[key].at < DAY) return cache[key].xml;

  // One connection, with at least three seconds between requests, across tabs/restarts.
  const delay = Math.max(0, (saved[LAST] || 0) + 3000 - Date.now());
  if (delay) await new Promise(resolve => setTimeout(resolve, delay));
  await chrome.storage.local.set({ [LAST]: Date.now() });
  const response = await fetch(titleQuery(title), {
    credentials: "omit", redirect: "error", signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new Error("Lookup unavailable");
  const xml = await response.text();
  if (xml.length > 64000 || !xml.includes("</feed>")) throw new Error("Invalid lookup response");
  cache[key] = { at: Date.now(), xml };
  const recent = Object.entries(cache).filter(([, value]) => Date.now() - value.at < DAY)
    .sort((a, b) => b[1].at - a[1].at).slice(0, 40);
  await chrome.storage.local.set({ [CACHE]: Object.fromEntries(recent) });
  return xml;
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type === "download-paper") {
    const id = /^https:\/\/arxiv\.org\/html\//.test(sender.url || "") && arxivID(sender.url);
    if (!id) {
      respond({ started: false });
      return;
    }
    downloadPaper(id, message.title).then(respond, error => {
      const needsAccess = ["NotAllowedError", "NotFoundError"].includes(error.name);
      respond({ error: needsAccess ? "Reconnect your download folder in arXiv Hop." : "Couldn't save the PDF. Please try again." });
    });
    return true;
  }

  if (message?.type !== "lookup-title") return;
  if (!/^https:\/\/arxiv\.org\/html\//.test(sender.url || "")
    || typeof message.title !== "string" || !titleQuery(message.title)) {
    respond({ xml: null });
    return;
  }
  const key = normalizeTitle(message.title);
  if (!pending.has(key)) {
    if (pending.size >= 8) { respond({ xml: null }); return; }
    const work = lookupQueue.then(() => lookup(message.title)).catch(() => null);
    pending.set(key, work);
    lookupQueue = work;
    void work.finally(() => pending.delete(key));
  }
  void pending.get(key).then(xml => respond({ xml }));
  return true;
});
