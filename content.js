/* Runs only on arXiv pages. The toolbar setting is shared across open papers. */
(() => {
  "use strict";
  const { arxivID, resolveReference, citationTarget, webURL, referenceTitle, titleQuery, matchTitle } = globalThis.ArxivHopResolver;
  if (document.documentElement.hasAttribute("data-arxiv-hop-loaded")) return;
  document.documentElement.setAttribute("data-arxiv-hop-loaded", "");

  const paperID = arxivID(location.href);
  if (paperID) {
    const downloadButton = 'a.download-pdf, a.mobile-submission-download, a[title="Download PDF"]';

    document.addEventListener("click", async event => {
      if (!event.isTrusted || event.button !== 0 || event.defaultPrevented
        || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const link = event.target.closest?.(downloadButton);
      const pdf = link && webURL(link.href);
      if (!pdf || pdf.origin !== location.origin || !pdf.pathname.startsWith("/pdf/")
        || arxivID(pdf.href) !== paperID) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      const title = document.querySelector('meta[name="citation_title"]')?.content.trim()
        || document.querySelector("h1.ltx_title_document")?.textContent.trim();
      try {
        const result = await chrome.runtime.sendMessage({ type: "download-paper", title });
        if (!result?.started && !result?.alreadySaved) {
          console.warn("arXiv Hop could not start the PDF download.", result?.error);
        }
      } catch (error) {
        console.warn("arXiv Hop could not start the PDF download.", error);
      }
    }, true);
  }

  function observeSettings(update) {
    const defaults = { enabled: true, destination: "html" };
    const settings = { ...defaults };
    const changedBeforeLoad = new Set();
    let loaded = false;
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      let changed = false;
      for (const key of Object.keys(defaults)) {
        if (!changes[key]) continue;
        if (!loaded) changedBeforeLoad.add(key);
        settings[key] = changes[key].newValue ?? defaults[key];
        changed = true;
      }
      if (loaded && changed) update(settings);
    });
    chrome.storage.local.get(defaults).then(saved => {
      for (const key of Object.keys(defaults)) {
        if (!changedBeforeLoad.has(key)) settings[key] = saved[key];
      }
      loaded = true;
      update(settings);
    }).catch(error => console.warn("arXiv Hop could not read its setting.", error));
  }

  if (location.pathname.startsWith("/abs/")) {
    const html = document.querySelector("#latexml-download-link");
    if (html && webURL(html.href)?.pathname.startsWith("/html/")) {
      const hint = document.createElement("p");
      hint.className = "arxiv-hop-abstract-hint";
      hint.textContent = "arXiv Hop: open HTML to follow citations in new tabs.";
      hint.hidden = true;
      html.insertAdjacentElement("afterend", hint);
      observeSettings(settings => { hint.hidden = settings.enabled === false; });
    }
    return;
  }

  const bibliography = [...document.querySelectorAll(".ltx_bibitem[id]")];
  if (!bibliography.length) return;
  const references = new Map();
  for (const item of bibliography) {
    const clone = item.cloneNode(true);
    clone.querySelectorAll(".ltx_bib_cited, .ltx_tag_bibitem").forEach(node => node.remove());
    const blocks = [...clone.querySelectorAll(".ltx_bibblock")].map(node => node.textContent);
    const title = referenceTitle(clone.querySelector(".ltx_bib_title")?.textContent, blocks);
    const text = blocks.join(" ") || clone.textContent;
    const links = [...clone.querySelectorAll("a[href]")].map(a => webURL(a.getAttribute("href"), location.href))
      .filter(url => url && !(url.origin === location.origin && url.pathname === location.pathname))
      .map(url => url.href);
    const identifiers = [...clone.querySelectorAll(".ltx_bib_external")].map(node => node.textContent.trim());
    references.set(item.id, resolveReference({ title, text, links, identifiers }));
  }

  const citations = new Map();
  // A real bibliography target is required; section, figure and footnote links stay native.
  for (const link of document.querySelectorAll("a[href]")) {
    if (link.closest(".ltx_bibitem")) continue;
    const url = webURL(link.getAttribute("href"), location.href);
    if (!url || url.origin !== location.origin || url.pathname !== location.pathname || !url.hash) continue;
    let id;
    try { id = decodeURIComponent(url.hash.slice(1)); } catch { continue; }
    const result = references.get(id);
    if (!result) continue;
    citations.set(link, {
      result, id,
      original: Object.fromEntries(["href", "target", "rel", "title", "aria-describedby"].map(key => [key, link.getAttribute(key)]))
    });
  }
  if (!citations.size) return;

  let enabled = false;
  let destination = "html";
  let activeLink = null;
  let dismissTimer;
  let lookupTimer;
  const card = document.createElement("section");
  card.id = "arxiv-hop-preview";
  card.setAttribute("aria-label", "Citation preview");
  card.hidden = true;
  const source = document.createElement("div");
  source.className = "arxiv-hop-source";
  source.setAttribute("aria-live", "polite");
  const heading = document.createElement("div");
  heading.className = "arxiv-hop-title";
  const detail = document.createElement("p");
  detail.className = "arxiv-hop-detail";
  const actions = document.createElement("div");
  actions.className = "arxiv-hop-actions";
  const primary = document.createElement("a");
  primary.className = "arxiv-hop-primary";
  const paper = document.createElement("a");
  const original = document.createElement("a");
  original.textContent = "Bibliography";
  for (const a of [primary, paper]) { a.target = "_blank"; a.rel = "noopener noreferrer"; }
  actions.append(primary, paper, original);
  card.append(source, heading, detail, actions);
  document.body.append(card);

  function hide() { clearTimeout(lookupTimer); card.hidden = true; activeLink = null; }
  function laterHide() { clearTimeout(lookupTimer); clearTimeout(dismissTimer); dismissTimer = setTimeout(hide, 180); }
  function preview(link) {
    if (!enabled) return;
    clearTimeout(dismissTimer);
    activeLink = link;
    const { result, id, original: attrs } = citations.get(link);
    const target = citationTarget(result, destination);
    source.textContent = result.kind === "arxiv" ? `arXiv · ${result.id}${result.viaLookup ? " · title match" : ""}`
      : result.lookupState === "pending" ? "Checking arXiv… · Google available"
      : result.kind === "search" ? "No direct link · search fallback"
      : result.kind === "doi" ? "DOI · publisher page" : "Link from the bibliography";
    heading.textContent = result.title || "Cited reference";
    detail.textContent = result.text.slice(0, 650) + (result.text.length > 650 ? "…" : "");
    primary.href = target.url;
    primary.textContent = target.label + " ↗";
    paper.hidden = !result.paperURL || result.paperURL === target.url;
    paper.href = result.paperURL || result.url;
    paper.textContent = "Abstract ↗";
    original.href = attrs.href;
    original.onclick = event => {
      event.preventDefault();
      const item = document.getElementById(id);
      item?.scrollIntoView({ block: "center" });
      hide();
    };
    card.hidden = false;
    const rect = link.getBoundingClientRect();
    const width = card.offsetWidth;
    const height = card.offsetHeight;
    card.style.left = `${Math.max(12, Math.min(rect.left, innerWidth - width - 12))}px`;
    const below = rect.bottom + 10;
    const top = below + height <= innerHeight - 12 ? below : rect.top - height - 10;
    card.style.top = `${Math.max(12, Math.min(top, innerHeight - height - 12))}px`;
  }

  function applyLink(link, { result, original }) {
    if (enabled) {
      const target = citationTarget(result, destination);
      link.href = target.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.title = `${target.label}${result.title ? `: ${result.title}` : ""}. Alt-click for the bibliography.`;
      link.dataset.arxivHop = result.kind;
    } else {
      for (const [key, value] of Object.entries(original)) {
        if (value === null) link.removeAttribute(key); else link.setAttribute(key, value);
      }
      delete link.dataset.arxivHop;
    }
  }

  function apply() {
    for (const [link, entry] of citations) applyLink(link, entry);
    hide();
  }

  async function lookup(result) {
    result.lookupState = "pending";
    if (activeLink && citations.get(activeLink).result === result) preview(activeLink);
    try {
      const response = await chrome.runtime.sendMessage({ type: "lookup-title", title: result.title });
      if (response?.xml) {
        const feed = new DOMParser().parseFromString(response.xml, "application/xml");
        if (!feed.querySelector("parsererror")) {
          const atom = "http://www.w3.org/2005/Atom";
          const value = (node, tag) => node.getElementsByTagNameNS(atom, tag)[0]?.textContent || "";
          const entries = [...feed.getElementsByTagNameNS(atom, "entry")]
            .map(entry => ({ id: value(entry, "id"), title: value(entry, "title") }));
          const count = feed.getElementsByTagNameNS("http://a9.com/-/spec/opensearch/1.1/", "totalResults")[0]?.textContent;
          const match = matchTitle(result.title, entries, count?.trim() ? Number(count) : NaN);
          if (match) Object.assign(result, resolveReference({ title: match.title, text: result.text, identifiers: [match.id] }), { viaLookup: true });
        }
      }
    } catch { /* Offline, timeout or extension reload: Google remains usable. */ }
    result.lookupState = "done";
    for (const [link, entry] of citations) if (entry.result === result) applyLink(link, entry);
    if (enabled && activeLink && citations.get(activeLink).result === result) preview(activeLink);
  }

  function beginPreview(link) {
    preview(link);
    clearTimeout(lookupTimer);
    const { result } = citations.get(link);
    if (enabled && result.kind === "search" && !result.ambiguous && !result.lookupState && titleQuery(result.title)) {
      lookupTimer = setTimeout(() => { if (enabled && activeLink === link) void lookup(result); }, 350);
    }
  }

  for (const link of citations.keys()) {
    link.addEventListener("mouseenter", () => beginPreview(link));
    link.addEventListener("mousemove", () => { if (card.hidden) beginPreview(link); });
    link.addEventListener("mouseleave", laterHide);
    link.addEventListener("focus", () => beginPreview(link));
    link.addEventListener("blur", laterHide);
  }
  card.addEventListener("mouseenter", () => clearTimeout(dismissTimer));
  card.addEventListener("mouseleave", laterHide);
  card.addEventListener("focusin", () => clearTimeout(dismissTimer));
  card.addEventListener("focusout", event => { if (!card.contains(event.relatedTarget)) laterHide(); });
  document.addEventListener("keydown", event => { if (event.key === "Escape") hide(); });
  function reposition() {
    if (!activeLink || card.hidden) return;
    const rect = activeLink.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > innerHeight) hide();
    else preview(activeLink);
  }
  window.addEventListener("scroll", reposition, { passive: true });
  window.addEventListener("resize", reposition, { passive: true });
  // Capture before arXiv's own reference handlers. Keep native new-tab behavior,
  // including modifier/middle clicks and the link's right-click context menu.
  for (const type of ["click", "auxclick"]) {
    document.addEventListener(type, event => {
      const link = event.target.closest?.("a");
      if (!enabled || !citations.has(link)) return;
      if (event.altKey && type === "click") {
        event.preventDefault();
        document.getElementById(citations.get(link).id)?.scrollIntoView({ block: "center" });
        hide();
      }
      event.stopImmediatePropagation();
    }, true);
  }
  observeSettings(settings => {
    enabled = settings.enabled !== false;
    destination = settings.destination;
    apply();
  });
})();
