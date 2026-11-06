const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const resolver = require("../resolver.js");

function worker({ fetcher, saved = {} } = {}) {
  let listener;
  let now = 20000000000;
  const calls = [];
  const waits = [];
  const context = vm.createContext({
    importScripts() {}, ArxivHopResolver: resolver, AbortSignal,
    Date: class extends Date { static now() { return now; } },
    setTimeout(callback, delay) { waits.push(delay); now += delay; queueMicrotask(callback); },
    chrome: {
      storage: { local: {
        async get() { return structuredClone(saved); },
        async set(values) { Object.assign(saved, structuredClone(values)); }
      } },
      runtime: { onMessage: { addListener(fn) { listener = fn; } } }
    },
    fetch: async (url, options) => {
      calls.push({ url, options });
      return fetcher ? fetcher(url, options) : { ok: true, text: async () => "<feed></feed>" };
    }
  });
  vm.runInContext(fs.readFileSync(require.resolve("../background.js"), "utf8"), context);
  return {
    calls, waits, saved,
    send(title, url = "https://arxiv.org/html/1706.03762v7") {
      return new Promise(resolve => listener({ type: "lookup-title", title }, { url }, resolve));
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
