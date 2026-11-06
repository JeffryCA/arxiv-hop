/* arXiv Hop: deterministic citation resolution, with no network requests. */
(() => {
  "use strict";
  const MODERN = String.raw`\d{2}(?:0[1-9]|1[0-2])\.\d{4,5}`;
  const LEGACY = String.raw`[a-z][a-z.-]*\/\d{2}(?:0[1-9]|1[0-2])\d{3}`;
  const ID = `(?:${MODERN}|${LEGACY})(?:v[1-9]\\d*)?`;
  const idPattern = new RegExp(`^${ID}$`, "i");
  const clean = value => String(value || "").replace(/\s+/g, " ").trim();
  const decode = value => { try { return decodeURIComponent(value); } catch { return value; } };

  function webURL(value, base = "https://arxiv.org/") {
    try {
      const url = new URL(value, base);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
      return url;
    } catch { return null; }
  }

  function arxivID(value) {
    const raw = clean(value).replace(/^arxiv\s*:\s*/i, "");
    if (idPattern.test(raw)) return raw;
    const url = webURL(raw);
    if (!url) return null;
    if (["arxiv.org", "www.arxiv.org", "export.arxiv.org"].includes(url.hostname)) {
      const id = url.pathname.replace(/^\/(?:abs|pdf|html)\//, "").replace(/\.pdf$/i, "");
      return idPattern.test(id) ? id : null;
    }
    if (["doi.org", "dx.doi.org"].includes(url.hostname)) {
      const match = decode(url.pathname).match(/^\/10\.48550\/arxiv\.(.+)$/i);
      if (match && idPattern.test(match[1])) return match[1];
    }
    return null;
  }

  function trimDOI(value) {
    let doi = value.replace(/[.,;:]+$/, "");
    for (const [open, close] of [["(", ")"], ["[", "]"]]) {
      while (doi.endsWith(close) && doi.split(close).length > doi.split(open).length) doi = doi.slice(0, -1);
    }
    return doi;
  }

  function resolveReference({ text = "", title = "", links = [], identifiers = [] } = {}) {
    text = clean(text);
    title = clean(title);
    const query = (title || text.replace(/^\[\d+\]\s*/, "")).slice(0, 450);
    const search = new URL("https://arxiv.org/search/");
    search.search = new URLSearchParams({ query, searchtype: title ? "title" : "all" }).toString();
    const fallback = { kind: "search", label: "Search arXiv", url: search.href, query, title, text };

    // Only accept bare IDs in explicit identifier fields, never arbitrary numbers in prose.
    const ids = new Set([...links, ...identifiers].map(arxivID).filter(Boolean));
    const textPattern = new RegExp(`\\barxiv\\s*:?\\s*(${ID})(?![\\w/])`, "gi");
    for (const match of text.matchAll(textPattern)) ids.add(match[1]);
    // Multiple IDs in one entry are ambiguous: do not silently pick a paper.
    const papers = new Map();
    for (const id of ids) {
      const key = id.replace(/v\d+$/, "").toLowerCase();
      if (!papers.has(key)) papers.set(key, id);
    }
    if (papers.size > 1) return { ...fallback, ambiguous: true };
    if (papers.size === 1) {
      const id = [...papers.values()][0];
      return { kind: "arxiv", label: "Open arXiv PDF", url: `https://arxiv.org/pdf/${id}`,
        paperURL: `https://arxiv.org/abs/${id}`, id, title, text };
    }

    const urls = links.map(link => webURL(link)).filter(Boolean);
    for (const url of urls) {
      if (["doi.org", "dx.doi.org"].includes(url.hostname)) {
        const doi = trimDOI(decode(url.pathname.slice(1)));
        if (/^10\.\d{4,9}\/\S+$/i.test(doi)) {
          return { kind: "doi", label: "Open DOI page", url: `https://doi.org/${doi}`, title, text };
        }
      }
    }
    const doiMatch = text.match(/\b10\.\d{4,9}\/[^\s<>"“”]+/i);
    if (doiMatch) return { kind: "doi", label: "Open DOI page", url: `https://doi.org/${trimDOI(doiMatch[0])}`, title, text };

    const external = urls.filter(url => !["arxiv.org", "www.arxiv.org", "export.arxiv.org"].includes(url.hostname));
    const linked = external.find(url => /\.pdf$/i.test(url.pathname)) || external[0];
    if (linked) return { kind: "link", label: /\.pdf$/i.test(linked.pathname) ? "Open linked PDF" : "Open linked page", url: linked.href, title, text };
    return fallback;
  }

  const api = { arxivID, resolveReference, webURL };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else globalThis.ArxivHopResolver = api;
})();
