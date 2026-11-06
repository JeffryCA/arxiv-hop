/* Runs only on arXiv pages. The toolbar setting is shared across open papers. */
(() => {
  "use strict";
  const { resolveReference, webURL } = globalThis.ArxivHopResolver;
  if (document.documentElement.hasAttribute("data-arxiv-hop-loaded")) return;
  document.documentElement.setAttribute("data-arxiv-hop-loaded", "");

  function observeEnabled(update) {
    let revision = 0;
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !changes.enabled) return;
      revision++;
      update(changes.enabled.newValue !== false);
    });
    const initialRevision = revision;
    chrome.storage.local.get({ enabled: true }).then(settings => {
      if (revision === initialRevision) update(settings.enabled !== false);
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
      observeEnabled(enabled => { hint.hidden = !enabled; });
    }
    return;
  }

  const bibliography = [...document.querySelectorAll(".ltx_bibitem[id]")];
  if (!bibliography.length) return;
  const references = new Map();
  for (const item of bibliography) {
    const clone = item.cloneNode(true);
    clone.querySelectorAll(".ltx_bib_cited, .ltx_tag_bibitem").forEach(node => node.remove());
    const title = clone.querySelector(".ltx_bib_title")?.textContent || "";
    const text = [...clone.querySelectorAll(".ltx_bibblock")].map(node => node.textContent).join(" ") || clone.textContent;
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
  let activeLink = null;
  let dismissTimer;
  const card = document.createElement("section");
  card.id = "arxiv-hop-preview";
  card.setAttribute("aria-label", "Citation preview");
  card.hidden = true;
  const source = document.createElement("div");
  source.className = "arxiv-hop-source";
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

  function hide() { card.hidden = true; activeLink = null; }
  function laterHide() { clearTimeout(dismissTimer); dismissTimer = setTimeout(hide, 180); }
  function preview(link) {
    if (!enabled) return;
    clearTimeout(dismissTimer);
    activeLink = link;
    const { result, id, original: attrs } = citations.get(link);
    source.textContent = result.kind === "arxiv" ? `arXiv · ${result.id}` : result.kind === "search" ? "No direct link · search fallback" : result.kind === "doi" ? "DOI · publisher page" : "Link from the bibliography";
    heading.textContent = result.title || "Cited reference";
    detail.textContent = result.text.slice(0, 650) + (result.text.length > 650 ? "…" : "");
    primary.href = result.url;
    primary.textContent = result.label + " ↗";
    paper.hidden = !result.paperURL;
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

  function apply() {
    for (const [link, { result, original }] of citations) {
      if (enabled) {
        link.href = result.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.title = `${result.label}${result.title ? `: ${result.title}` : ""}. Alt-click for the bibliography.`;
        link.dataset.arxivHop = result.kind;
      } else {
        for (const [key, value] of Object.entries(original)) {
          if (value === null) link.removeAttribute(key); else link.setAttribute(key, value);
        }
        delete link.dataset.arxivHop;
      }
    }
    hide();
  }

  for (const link of citations.keys()) {
    link.addEventListener("mouseenter", () => preview(link));
    link.addEventListener("mousemove", () => { if (card.hidden) preview(link); });
    link.addEventListener("mouseleave", laterHide);
    link.addEventListener("focus", () => preview(link));
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
  observeEnabled(value => { enabled = value; apply(); });
})();
