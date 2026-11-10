const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const resolver = require("../resolver.js");
const downloads = require("../downloads.js");

function worker({ fetcher, saved = {}, folder = null } = {}) {
  let listener;
  let now = 20000000000;
  const calls = [];
  const waits = [];
  const downloadCalls = [];
  const context = vm.createContext({
    importScripts() {}, ArxivHopResolver: resolver,
    ArxivHopDownloads: { ...downloads, folderRecord: async () => folder }, AbortSignal,
    Date: class extends Date { static now() { return now; } },
    setTimeout(callback, delay) { waits.push(delay); now += delay; queueMicrotask(callback); },
    chrome: {
      storage: { local: {
        async get(keys) { return Array.isArray(keys) ? structuredClone(saved) : { ...keys, ...structuredClone(saved) }; },
        async set(values) { Object.assign(saved, structuredClone(values)); }
      } },
      runtime: { onMessage: { addListener(fn) { listener = fn; } } },
      downloads: { async download(options) { downloadCalls.push(structuredClone(options)); return 1; } }
    },
    fetch: async (url, options) => {
      calls.push({ url, options });
      return fetcher ? fetcher(url, options) : { ok: true, text: async () => "<feed></feed>" };
    }
  });
  vm.runInContext(fs.readFileSync(require.resolve("../background.js"), "utf8"), context);
  return {
    calls, waits, saved, downloadCalls,
    send(title, url = "https://arxiv.org/html/1706.03762v7") {
      return new Promise(resolve => listener({ type: "lookup-title", title }, { url }, resolve));
    },
    download(title, url = "https://arxiv.org/html/1706.03762v7") {
      return new Promise(resolve => listener({ type: "download-paper", title }, { url }, resolve));
    }
  };
}

test("hover requests are deduplicated and cached across worker restarts, including empty feeds", async () => {
  const first = worker();
  const results = await Promise.all([first.send("Sequence to sequence learning with neural networks"), first.send("Sequence-to-sequence learning with neural networks.")]);
  assert.equal(results[0].xml, "<feed></feed>");
  assert.equal(first.calls.length, 1);
  await first.send("Sequence to sequence learning with neural networks");
  assert.equal(first.calls.length, 1);
  const restarted = worker({ saved: first.saved });
  await restarted.send("Sequence to sequence learning with neural networks");
  assert.equal(restarted.calls.length, 0);
  assert.equal(first.calls[0].options.credentials, "omit");
});

test("downloads use the page's versioned PDF and a safe title by default", async () => {
  const instance = worker();
  assert.equal((await instance.download("A Study: Vision / Language?")).started, true);
  assert.deepEqual(instance.downloadCalls, [{
    url: "https://arxiv.org/pdf/1706.03762v7",
    filename: "A Study Vision Language.pdf",
    saveAs: false,
    conflictAction: "uniquify"
  }]);
});

test("ID naming works for legacy papers and missing titles", async () => {
  const instance = worker({ saved: { downloadFolder: "Papers/ Robotics ", downloadNaming: "id" } });
  await instance.download("An Older Paper", "https://arxiv.org/html/cs/9901001v2");
  assert.equal(instance.downloadCalls[0].filename, "Papers/Robotics/cs-9901001v2.pdf");
  const defaults = worker();
  await defaults.download();
  await defaults.download("NUL");
  assert.deepEqual(defaults.downloadCalls.map(call => call.filename), ["1706.03762v7.pdf", "1706.03762v7.pdf"]);
});

test("abstract-page downloads use the same saved folder and naming settings", async () => {
  const instance = worker({ saved: { downloadFolder: "Papers", downloadNaming: "id" } });
  assert.equal((await instance.download("Paper", "https://arxiv.org/abs/1706.03762v7")).started, true);
  assert.deepEqual(instance.downloadCalls, [{
    url: "https://arxiv.org/pdf/1706.03762v7",
    filename: "Papers/1706.03762v7.pdf",
    saveAs: false,
    conflictAction: "uniquify"
  }]);
});

test("download requests cannot use an external sender or escape Downloads", async () => {
  const instance = worker({ saved: { downloadFolder: "../Papers" } });
  assert.equal((await instance.download("Some Paper", "https://example.org/html/1706.03762")).started, false);
  assert.equal((await instance.download("Some Paper", "https://arxiv.org/html/invalid")).started, false);
  await instance.download("Some Paper");
  assert.equal(instance.downloadCalls.length, 1);
  assert.equal(instance.downloadCalls[0].filename, "Some Paper.pdf");
  for (const path of ["/tmp/Papers", "C:/Papers", "Papers/../Robotics", "Papers\\Robotics", "Papers/CON"]) {
    assert.equal(downloads.relativeFolder(path), null);
  }
});

function pickedFolder(files) {
  return {
    name: "Research",
    async queryPermission() { return "granted"; },
    async *values() {
      for (const name of files.keys()) yield await this.getFileHandle(name);
    },
    async getFileHandle(name, { create } = {}) {
      if (!create && !files.has(name)) throw new DOMException("Missing", "NotFoundError");
      return {
        name, kind: "file",
        async getFile() { return new Blob([files.get(name)]); },
        async createWritable() {
          return new WritableStream({ write(chunk) { files.set(name, new TextDecoder().decode(chunk)); } });
        }
      };
    }
  };
}

test("a picked folder skips existing PDFs by title or arXiv ID before fetching", async () => {
  for (const name of ["Paper.pdf", "Paper (1).pdf", "1706.03762.pdf", "1706.03762v3.pdf"]) {
    const instance = worker({
      folder: pickedFolder(new Map([[name, "%PDF-1.5"]])),
      saved: { downloadNaming: "id" }
    });
    assert.equal((await instance.download("Paper")).alreadySaved, true);
    assert.equal(instance.calls.length, 0);
    assert.equal(instance.downloadCalls.length, 0);
  }
});

test("concurrent saves create one PDF and preserve a file with the same name", async () => {
  const files = new Map([["Paper.pdf", "existing"]]);
  const instance = worker({
    folder: pickedFolder(files),
    saved: { downloadFolder: "Old/Subfolder" },
    fetcher: () => new Response("%PDF-1.5", { headers: { "content-type": "application/pdf" } })
  });
  const results = await Promise.all([instance.download("Paper"), instance.download("Paper")]);
  assert.equal(results[0].started, true);
  assert.equal(results[1].alreadySaved, true);
  assert.deepEqual([...files.entries()], [
    ["Paper.pdf", "existing"], ["Paper (1).pdf", "%PDF-1.5"]
  ]);
  assert.equal(instance.calls.length, 1);
  assert.equal(instance.downloadCalls.length, 0);
});

test("a disconnected folder asks for access before fetching the PDF", async () => {
  const instance = worker({ folder: { async queryPermission() { return "prompt"; } } });
  assert.match((await instance.download("Paper")).error, /Reconnect/);
  assert.equal(instance.calls.length, 0);
  assert.equal(instance.downloadCalls.length, 0);
});

test("requests across titles are serialized and separated by three seconds", async () => {
  let active = 0;
  const instance = worker({ fetcher: async () => {
    assert.equal(++active, 1);
    await Promise.resolve();
    active--;
    return { ok: true, text: async () => "<feed></feed>" };
  } });
  await Promise.all([instance.send("Sequence to sequence learning with neural networks"), instance.send("Attention is all you need")]);
  assert.equal(instance.calls.length, 2);
  assert.deepEqual(instance.waits, [3000]);
  const restarted = worker({ saved: instance.saved });
  await restarted.send("Learning transferable visual representations");
  assert.ok(restarted.waits[0] >= 3000);
});

test("network failures, bad responses and invalid requests preserve a null fallback", async () => {
  for (const fetcher of [
    async () => { throw new Error("Offline or timed out"); },
    async () => ({ ok: false, status: 429 }),
    async () => ({ ok: true, text: async () => "not an Atom feed" }),
    async () => ({ ok: true, text: async () => "x".repeat(64001) + "</feed>" })
  ]) {
    const instance = worker({ fetcher });
    assert.equal((await instance.send("Attention is all you need")).xml, null);
    assert.equal(instance.saved.titleLookupCacheV1, undefined);
  }
  const instance = worker();
  assert.equal((await instance.send("Attention is all you need", "https://evil.test/html/paper")).xml, null);
  assert.equal((await instance.send("AI")).xml, null);
  assert.equal(instance.calls.length, 0);
});
