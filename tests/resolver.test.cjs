const { test } = require("node:test");
const assert = require("node:assert/strict");
const { arxivID, resolveReference } = require("../resolver.js");

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
  assert.equal(new URL(result.url).searchParams.get("query"), "Learning & control: a study");
  assert.equal(new URL(result.url).searchParams.get("searchtype"), "title");
});

test("unsafe links and malformed escape sequences cannot break resolution", () => {
  assert.equal(resolveReference({ links: ["javascript:alert(1)", "data:text/html,hi", "file:///tmp/paper.pdf", "https://user:secret@example.org/paper.pdf"] }).kind, "search");
  assert.doesNotThrow(() => resolveReference({ links: ["https://doi.org/10.1000/%E0%A4%A"] }));
});
