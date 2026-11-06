const { test } = require("node:test");
const assert = require("node:assert/strict");
const { arxivID, resolveReference, citationTarget, normalizeTitle, referenceTitle, titleQuery, matchTitle } = require("../resolver.js");

test("titles tolerate typography while preserving word order, numbers and mathematical signs", () => {
  assert.equal(normalizeTitle("Sequence-to-Sequence Learning: with Neural Networks."), normalizeTitle("sequence to sequence learning with neural networks"));
  assert.equal(normalizeTitle("Vision & Control"), normalizeTitle("Vision and Control"));
  assert.notEqual(normalizeTitle("Learning without supervision"), normalizeTitle("Learning with supervision"));
  assert.notEqual(normalizeTitle("GPT-3 for language learning"), normalizeTitle("GPT-4 for language learning"));
  assert.notEqual(normalizeTitle("Learning a + b"), normalizeTitle("Learning a = b"));
});

test("unmarked author/title/venue blocks recover Attention's reference 35 without guessing other layouts", () => {
  assert.equal(referenceTitle("", ["Ilya Sutskever, Oriol Vinyals, and Quoc VV Le.", "Sequence to sequence learning with neural networks.\n", "In Advances in Neural Information Processing Systems, pages 3104–3112, 2014."]), "Sequence to sequence learning with neural networks");
  assert.equal(referenceTitle("An explicitly marked title.", []), "An explicitly marked title");
  assert.equal(referenceTitle("", ["Authors. Title. Venue, 2014."]), "");
  assert.equal(referenceTitle("", ["Authors", "In Some Conference", "2014"]), "");
});

test("title lookup accepts a unique full match and rejects ambiguity, partials and incomplete feeds", () => {
  const title = "Sequence to sequence learning with neural networks";
  const entry = { id: "http://arxiv.org/abs/1409.3215v3", title: "Sequence-to-Sequence Learning with Neural Networks" };
  assert.equal(matchTitle(title, [entry], 1).id, "1409.3215v3");
  assert.equal(matchTitle(title, [entry, { ...entry, id: "1409.3215v2" }], 2).id, "1409.3215v2");
  assert.equal(matchTitle(title, [entry, { ...entry, id: "2406.09246" }], 2), null);
  assert.equal(matchTitle(title, [{ ...entry, title: entry.title + " with Attention" }], 1), null);
  assert.equal(matchTitle(title, [entry], 2), null);
  assert.equal(matchTitle(title, [entry], 11), null);
  assert.equal(matchTitle(title, [{ ...entry, id: "https://example.org/abs/1409.3215" }], 1), null);
  assert.equal(matchTitle(title, [], 0), null);
});

test("queries use a fixed public API endpoint and cannot inject search operators", () => {
  const url = new URL(titleQuery('Neural learning \" OR all:electron'));
  assert.equal(url.origin, "https://export.arxiv.org");
  assert.equal(url.searchParams.get("search_query"), 'ti:"neural learning or all electron"');
  assert.equal(url.searchParams.get("max_results"), "10");
  assert.equal(titleQuery("AI"), null);
  assert.equal(titleQuery("a".repeat(351)), null);
});

test("modern, versioned, legacy and arXiv DOI identifiers", () => {
  for (const [input, id] of [
    ["http://arxiv.org/abs/2406.09246", "2406.09246"],
    ["https://arxiv.org/pdf/2406.09246v2.pdf", "2406.09246v2"],
    ["https://export.arxiv.org/abs/hep-th/9901001v1", "hep-th/9901001v1"],
    ["https://doi.org/10.48550/arXiv.2406.09246", "2406.09246"],
    ["arXiv:2406.09246", "2406.09246"],
  ]) assert.equal(arxivID(input), id);
  for (const input of ["https://arxiv.org.evil.test/abs/2406.09246", "2419.09246", "2406.09246oops", "javascript:alert(1)"]) {
    assert.equal(arxivID(input), null);
  }
});

test("LaWAM OpenVLA reference resolves directly to its PDF", () => {
  const result = resolveReference({ title: "OpenVLA: an open-source vision-language-action model", text: "M. J. Kim et al. (2024). arXiv preprint arXiv:2406.09246.", links: ["http://arxiv.org/abs/2406.09246"] });
  assert.equal(result.kind, "arxiv");
  assert.equal(result.url, "https://arxiv.org/pdf/2406.09246");
  assert.equal(result.paperURL, "https://arxiv.org/abs/2406.09246");
});

test("explicit bibliography IDs work when only the proceedings PDF is linked", () => {
  const result = resolveReference({ title: "Robomind", identifiers: ["2412.13877"], links: ["https://www.roboticsproceedings.org/rss21/p152.pdf"] });
  assert.equal(result.url, "https://arxiv.org/pdf/2412.13877");
});

test("arXiv text IDs work without outbound links; unrelated prose numbers do not", () => {
  assert.equal(resolveReference({ text: "A paper. arXiv:hep-th/9901001v1." }).url, "https://arxiv.org/pdf/hep-th/9901001v1");
  assert.equal(resolveReference({ text: "Measurement 2406.09246 appeared in 2024." }).kind, "search");
});

test("arXiv PDF takes precedence over a publisher DOI; ambiguity becomes a search", () => {
  assert.equal(resolveReference({ links: ["https://doi.org/10.1234/example", "https://arxiv.org/abs/2406.09246"] }).kind, "arxiv");
  const result = resolveReference({ title: "Several papers", links: ["https://arxiv.org/abs/2406.09246", "https://arxiv.org/abs/2412.13877"] });
  assert.equal(result.kind, "search");
  assert.equal(result.ambiguous, true);
});

test("DOIs preserve balanced parentheses and remove sentence punctuation", () => {
  assert.equal(resolveReference({ text: "DOI: 10.1000/abc(2024)." }).url, "https://doi.org/10.1000/abc(2024)");
  assert.equal(resolveReference({ text: "(doi:10.1000/abc)." }).url, "https://doi.org/10.1000/abc");
  assert.equal(resolveReference({ links: ["http://dx.doi.org/10.1103/PhysRev.115.485"] }).url, "https://doi.org/10.1103/PhysRev.115.485");
});

test("linked PDFs, other paper pages, and honest title searches", () => {
  assert.equal(resolveReference({ links: ["https://openreview.net/forum?id=x", "https://example.org/paper.pdf"] }).url, "https://example.org/paper.pdf");
  assert.equal(resolveReference({ links: ["https://openreview.net/forum?id=x"] }).kind, "link");
  const result = resolveReference({ title: "Learning & control: a study", text: "Smith et al. 2025" });
  assert.equal(result.kind, "search");
  assert.equal(new URL(result.url).origin, "https://www.google.com");
  assert.equal(new URL(result.url).searchParams.get("q"), "Learning & control: a study");
  assert.equal(result.label, "Search Google");
  const unstructured = resolveReference({ text: "[17] Smith & Müller. A paper, 2024." });
  assert.equal(new URL(unstructured.url).searchParams.get("q"), "Smith & Müller. A paper, 2024.");
});

test("click destinations default to HTML and preserve versioned and legacy IDs", () => {
  for (const id of ["2406.09246v2", "hep-th/9901001v1"]) {
    const reference = resolveReference({ identifiers: [id] });
    assert.equal(citationTarget(reference).url, `https://arxiv.org/html/${id}`);
    assert.equal(citationTarget(reference, "html").label, "Open arXiv HTML");
    assert.equal(citationTarget(reference, "pdf").url, `https://arxiv.org/pdf/${id}`);
    assert.equal(citationTarget(reference, "abstract").url, `https://arxiv.org/abs/${id}`);
    assert.equal(citationTarget(reference, "unknown").url, `https://arxiv.org/html/${id}`);
  }
});

test("click preferences preserve DOI, external-paper, and Google fallbacks", () => {
  for (const reference of [
    resolveReference({ links: ["https://doi.org/10.1234/example"] }),
    resolveReference({ links: ["https://openreview.net/forum?id=x"] }),
    resolveReference({ title: "An unlinked paper" }),
  ]) {
    for (const destination of ["html", "pdf", "abstract"]) {
      assert.equal(citationTarget(reference, destination).url, reference.url);
    }
  }
});

test("unsafe links and malformed escape sequences cannot break resolution", () => {
  assert.equal(resolveReference({ links: ["javascript:alert(1)", "data:text/html,hi", "file:///tmp/paper.pdf", "https://user:secret@example.org/paper.pdf"] }).kind, "search");
  assert.doesNotThrow(() => resolveReference({ links: ["https://doi.org/10.1000/%E0%A4%A"] }));
});
