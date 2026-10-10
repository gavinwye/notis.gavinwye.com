import test from "node:test";
import assert from "node:assert/strict";
import { createHandler } from "../server/core.mjs";
import { storageFor as netlifyStorage } from "../server/netlify.mjs";
import { storageFor as kvStorage } from "../server/cloudflare.mjs";

// Small fakes with the same shape as the real Netlify Blobs store and a Workers KV namespace.
function fakeBlobs(initial = {}) {
  const m = new Map(Object.entries(initial));
  return {
    m,
    get: async (k) => (m.has(k) ? JSON.parse(JSON.stringify(m.get(k))) : null),
    setJSON: async (k, v) => { m.set(k, JSON.parse(JSON.stringify(v))); },
    delete: async (k) => { m.delete(k); },
    list: async ({ prefix = "" } = {}) => ({ blobs: [...m.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })) }),
  };
}
function fakeKV() {
  const m = new Map();
  return {
    get: async (k) => (m.has(k) ? JSON.parse(m.get(k)) : null),
    put: async (k, v) => { m.set(k, v); },
    delete: async (k) => { m.delete(k); },
    list: async ({ prefix = "" } = {}) => ({ keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }),
  };
}

async function roundTrip(storage) {
  const h = createHandler({ storage, config: { adminToken: "tok" } });
  const call = async (method, path, body, headers = {}) => {
    const r = await h(new Request("http://x" + path, { method, headers: { "content-type": "application/json", ...headers }, body: body && JSON.stringify(body) }));
    return r.json();
  };
  const t = await call("POST", "/api/comments", { pageId: "/p", text: "one" });
  await call("POST", `/api/comments/${t.id}/replies`, { text: "two" });
  await call("PATCH", `/api/comments/${t.id}`, { resolved: true });
  const list = await call("GET", "/api/comments?page=/p");
  assert.equal(list.length, 1);
  assert.equal(list[0].replies.length, 1);
  assert.equal(list[0].resolved, true);
  const gone = await call("DELETE", `/api/comments/${t.id}`, undefined, { authorization: "Bearer tok" });
  assert.equal(gone.removed, 1);
  assert.equal((await call("GET", "/api/comments")).length, 0);
}

test("netlify blobs adapter", async () => { await roundTrip(netlifyStorage(fakeBlobs())); });
test("cloudflare kv adapter", async () => { await roundTrip(kvStorage(fakeKV())); });

test("netlify adapter moves an older single-blob store to one blob per thread", async () => {
  const legacy = [{ id: "abc123def", pageId: "/p", text: "old", quote: "", replies: [], createdAt: 1, resolved: false }];
  const blobs = fakeBlobs({ threads: legacy });
  const list = await netlifyStorage(blobs).list();
  assert.equal(list.length, 1);
  assert.equal(list[0].text, "old");
  assert.equal(blobs.m.has("threads"), false);
  assert.equal(blobs.m.has("t/abc123def"), true);
});
