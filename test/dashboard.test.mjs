import test from "node:test";
import assert from "node:assert/strict";
import { createHandler, memoryStorage } from "../server/core.mjs";
import { dashboardHtml } from "../server/dashboard.mjs";
import { serverSources } from "../scripts/lib.mjs";

const make = (config = {}) => createHandler({ storage: memoryStorage(), config: { adminToken: "tok", ...config } });
const call = async (h, method, path, body, headers = {}) => {
  const r = await h(new Request("http://x" + path, {
    method, headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
  return { status: r.status, json: r.status === 204 ? null : await r.json(), headers: r.headers };
};
const admin = { authorization: "Bearer tok" };

const seed = async (h) => {
  const a = (await call(h, "POST", "/api/comments", { pageId: "/about/national", title: "National", url: "/about/national", quote: "q1", text: "one", author: "Priya" })).json;
  await call(h, "POST", "/api/comments", { pageId: "/about/national", title: "National page", url: "/about/national", quote: "q2", text: "two", author: "Tom" });
  await call(h, "POST", "/api/comments", { pageId: "/contact", text: "three", author: "Sam" });
  await call(h, "PATCH", `/api/comments/${a.id}`, { resolved: true });
  return a;
};

test("create: title and url are clipped, and unsafe urls are dropped", async () => {
  const h = make();
  const long = (await call(h, "POST", "/api/comments", { pageId: "/a", text: "x", title: "t".repeat(500), url: "/" + "u".repeat(900) })).json;
  assert.equal(long.title.length, 200);
  assert.equal(long.url.length, 500);
  let n = 0;
  for (const bad of ["javascript:alert(1)", "data:text/html,x", "//evil.example/x", "/\\evil.example", "ftp://x", "page"]) {
    const t = (await call(h, "POST", "/api/comments", { pageId: "/b" + n++, text: "y", url: bad })).json;
    assert.equal(t.url, "", bad);
  }
  assert.equal((await call(h, "POST", "/api/comments", { pageId: "/c", text: "z", url: "https://example.com/c?x=1" })).json.url, "https://example.com/c?x=1");
  assert.equal((await call(h, "POST", "/api/comments", { pageId: "/d", text: "z" })).json.url, "");
});

test("summary: admin token only unless the dashboard is public", async () => {
  const h = make();
  await seed(h);
  assert.equal((await call(h, "GET", "/api/comments?summary=1")).status, 403);
  assert.equal((await call(h, "GET", "/api/comments?summary=1", undefined, { authorization: "Bearer nope" })).status, 403);
  assert.equal((await call(h, "GET", "/api/comments?summary=1", undefined, admin)).status, 200);
  const open = make({ dashboard: "public" });
  await seed(open);
  assert.equal((await call(open, "GET", "/api/comments?summary=1")).status, 200);
  // Public opens the summary, not the full export.
  assert.equal((await call(open, "GET", "/api/comments")).status, 403);
});

test("summary: counts per page, newest title and url, no note text", async () => {
  const h = make();
  await seed(h);
  const { json } = await call(h, "GET", "/api/comments?summary=1", undefined, admin);
  assert.equal(json.length, 2);
  const nat = json.find((r) => r.pageId === "/about/national");
  assert.equal(nat.open, 1);
  assert.equal(nat.resolved, 1);
  assert.equal(nat.title, "National page");
  assert.equal(nat.url, "/about/national");
  const contact = json.find((r) => r.pageId === "/contact");
  assert.equal(contact.title, "");
  assert.equal(contact.url, "");
  assert.ok(nat.latest > 0);
  assert.equal(nat.openAt.length, 1); // when each open note was left, for "new since you last looked"
  assert.deepEqual(Object.keys(nat).sort(), ["latest", "open", "openAt", "pageId", "resolved", "title", "url"]);
});

test("dashboard: served as HTML with a fresh nonce, no token needed", async () => {
  const h = make();
  const get = () => h(new Request("http://x/api/comments/dashboard"));
  const [a, b] = [await get(), await get()];
  assert.equal(a.status, 200);
  assert.match(a.headers.get("content-type"), /^text\/html/);
  assert.equal(a.headers.get("cache-control"), "no-store");
  assert.equal(a.headers.get("x-content-type-options"), "nosniff");
  const csp = a.headers.get("content-security-policy");
  assert.match(csp, /default-src 'none'.*connect-src 'self'.*frame-ancestors 'none'/);
  const nonce = /script-src 'nonce-([^']+)'/.exec(csp)[1];
  const body = await a.text();
  assert.ok(body.includes(`<script nonce="${nonce}">`) && body.includes(`<style nonce="${nonce}">`));
  assert.ok(!body.includes("__NONCE__"));
  assert.notEqual(nonce, /script-src 'nonce-([^']+)'/.exec(b.headers.get("content-security-policy"))[1]);
});

test("dashboard: the word opens no other route", async () => {
  const h = make();
  assert.equal((await call(h, "DELETE", "/api/comments/dashboard")).status, 403);
  const t = (await call(h, "POST", "/api/comments", { pageId: "/a", text: "hi" })).json;
  assert.equal((await call(h, "PATCH", `/api/comments/${t.id}`, { resolved: true })).status, 200);
});

test("dashboard page: no HTML injection routes, no inline styles, no outside requests", () => {
  const html = dashboardHtml("abc");
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(/.test(html));
  assert.ok(!/style="/.test(html), "inline style attributes are blocked by the policy");
  // The only web-address text is the pattern that checks a stored url before linking to it.
  assert.equal(html.match(/https?:\/\//g), null);
  assert.ok(!/<(link|img|iframe)\b|<script src/.test(html));
});

test("every built server file carries the dashboard page and no leftover import", async () => {
  const sources = await serverSources();
  for (const [host, src] of Object.entries(sources)) {
    assert.ok(src.includes("dashboardHtml"), host);
    assert.ok(!src.includes('from "./dashboard.mjs"'), host);
    assert.ok(!src.includes('from "./core.mjs"'), host);
  }
});
