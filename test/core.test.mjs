import test from "node:test";
import assert from "node:assert/strict";
import { createHandler, memoryStorage } from "../server/core.mjs";

const make = (config = {}) => createHandler({ storage: memoryStorage(), config: { adminToken: "tok", ...config } });
const call = async (h, method, path, body, headers = {}) => {
  const r = await h(new Request("http://x" + path, {
    method, headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
  return { status: r.status, json: r.status === 204 ? null : await r.json(), headers: r.headers };
};

test("create: the server owns id and resolved", async () => {
  const h = make();
  const { status, json } = await call(h, "POST", "/api/comments", { pageId: "/a", quote: "q", text: "hi", id: "evil", resolved: true });
  assert.equal(status, 201);
  assert.notEqual(json.id, "evil");
  assert.equal(json.resolved, false);
  assert.deepEqual(json.replies, []);
});

test("create: text and pageId are required", async () => {
  const h = make();
  assert.equal((await call(h, "POST", "/api/comments", { pageId: "/a" })).status, 400);
  assert.equal((await call(h, "POST", "/api/comments", { text: "x" })).status, 400);
});

test("reply, resolve and list by page", async () => {
  const h = make();
  const t = (await call(h, "POST", "/api/comments", { pageId: "/a", text: "hi" })).json;
  assert.equal((await call(h, "POST", `/api/comments/${t.id}/replies`, { text: "re", author: "Sam" })).status, 201);
  const r = await call(h, "PATCH", `/api/comments/${t.id}`, { resolved: true });
  assert.equal(r.json.resolved, true);
  assert.equal(r.json.replies.length, 1);
  assert.equal((await call(h, "GET", "/api/comments?page=/a")).json.length, 1);
  assert.equal((await call(h, "GET", "/api/comments?page=/b")).json.length, 0);
  assert.equal((await call(h, "GET", "/api/comments")).json.length, 1);
});

test("concurrent replies are not lost", async () => {
  const h = make();
  const t = (await call(h, "POST", "/api/comments", { pageId: "/a", text: "hi" })).json;
  const replies = await Promise.all(Array.from({ length: 25 }, (_, i) =>
    call(h, "POST", `/api/comments/${t.id}/replies`, { text: `reply ${i}` })
  ));
  assert.ok(replies.every((reply) => reply.status === 201));
  const [saved] = (await call(h, "GET", "/api/comments?page=/a")).json;
  assert.equal(saved.replies.length, 25);
});

test("unknown thread is a 404; a malformed id never reaches storage", async () => {
  const h = make();
  assert.equal((await call(h, "PATCH", "/api/comments/abcdef123", { resolved: true })).status, 404);
  assert.equal((await call(h, "PATCH", "/api/comments/..%2F..%2Fetc", { resolved: true })).status, 404);
});

test("pins: kept, and validated", async () => {
  const h = make();
  const ok = await call(h, "POST", "/api/comments", { pageId: "/a", text: "p", pin: { src: "x.svg", alt: "A", i: 2, x: 0.25, y: 0.5 } });
  assert.equal(ok.status, 201);
  assert.deepEqual(ok.json.pin, { src: "x.svg", alt: "A", i: 2, x: 0.25, y: 0.5 });
  assert.equal(ok.json.quote, "");
  assert.equal((await call(h, "POST", "/api/comments", { pageId: "/a", text: "p", pin: { src: "x.svg", x: 2, y: 0.5 } })).status, 400);
  assert.equal((await call(h, "POST", "/api/comments", { pageId: "/a", text: "p", pin: { x: 0.1, y: 0.5 } })).status, 400);
});

test("delete needs the admin token, and is off without one", async () => {
  const h = make();
  const t = (await call(h, "POST", "/api/comments", { pageId: "/a", text: "hi" })).json;
  assert.equal((await call(h, "DELETE", `/api/comments/${t.id}`)).status, 403);
  assert.equal((await call(h, "DELETE", `/api/comments/${t.id}`, undefined, { authorization: "Bearer wrong" })).status, 403);
  const gone = await call(h, "DELETE", `/api/comments/${t.id}`, undefined, { authorization: "Bearer tok" });
  assert.equal(gone.json.removed, 1);
  const noToken = make({ adminToken: "" });
  const t2 = (await call(noToken, "POST", "/api/comments", { pageId: "/a", text: "hi" })).json;
  assert.equal((await call(noToken, "DELETE", `/api/comments/${t2.id}`, undefined, { authorization: "Bearer " })).status, 403);
});

test("clear removes everything", async () => {
  const h = make();
  await call(h, "POST", "/api/comments", { pageId: "/a", text: "1" });
  await call(h, "POST", "/api/comments", { pageId: "/a", text: "2" });
  await call(h, "DELETE", "/api/comments", undefined, { authorization: "Bearer tok" });
  assert.equal((await call(h, "GET", "/api/comments")).json.length, 0);
});

test("CORS: OPTIONS is a null-body 204, and a foreign origin is refused", async () => {
  const h = make({ allowedOrigins: ["https://site.example"] });
  assert.equal((await call(h, "OPTIONS", "/api/comments", undefined, { origin: "https://site.example" })).status, 204);
  const bad = await call(h, "POST", "/api/comments", { pageId: "/a", text: "x" }, { origin: "https://evil.example" });
  assert.equal(bad.status, 403);
  const good = await call(h, "GET", "/api/comments", undefined, { origin: "https://site.example" });
  assert.equal(good.headers.get("access-control-allow-origin"), "https://site.example");
});

test("oversized and invalid bodies", async () => {
  const h = make();
  const big = await h(new Request("http://x/api/comments", { method: "POST", body: "x".repeat(70 * 1024) }));
  assert.equal(big.status, 413);
  const bad = await h(new Request("http://x/api/comments", { method: "POST", body: "{nope" }));
  assert.equal(bad.status, 400);
});

test("other paths are not ours", async () => {
  assert.equal((await call(make(), "GET", "/somewhere/else")).status, 404);
});
