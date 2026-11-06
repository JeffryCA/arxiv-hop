/* Lazy public-metadata lookups. No requests until an unresolved citation is hovered. */
importScripts("resolver.js");
const { normalizeTitle, titleQuery } = globalThis.ArxivHopResolver;
const CACHE = "titleLookupCacheV1";
const LAST = "titleLookupLastRequest";
const DAY = 86400000;
const pending = new Map();
let queue = Promise.resolve();

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
  if (message?.type !== "lookup-title") return;
  if (!/^https:\/\/arxiv\.org\/html\//.test(sender.url || "")
    || typeof message.title !== "string" || !titleQuery(message.title)) {
    respond({ xml: null });
    return;
  }
  const key = normalizeTitle(message.title);
  if (!pending.has(key)) {
    if (pending.size >= 8) { respond({ xml: null }); return; }
    const work = queue.then(() => lookup(message.title)).catch(() => null);
    pending.set(key, work);
    queue = work;
    void work.finally(() => pending.delete(key));
  }
  void pending.get(key).then(xml => respond({ xml }));
  return true;
});
