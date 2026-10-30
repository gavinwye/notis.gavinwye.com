import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { ROOT } from "../scripts/lib.mjs";
import { renderDashboardDemo } from "../scripts/demo.mjs";

const html = await renderDashboardDemo(ROOT);

// Run the demo's stand-in server in a bare context and talk to it the way the page does.
async function demoServer() {
  const script = /<script>\n\(function \(\) \{\n {2}"use strict";\n[\s\S]*?\n<\/script>/.exec(html)[0].replace(/^<script>\n|\n<\/script>$/g, "");
  const window = { fetch: async () => { throw new Error("a real request was made"); } };
  window.fetch.bind = () => window.fetch;
  const ctx = vm.createContext({ window, location: { pathname: "/demo/dashboard/" }, Request, Response, URL, crypto, Promise, console });
  vm.runInContext(script, ctx);
  // Node needs absolute addresses; a browser resolves relative ones, which is what the page uses.
  return (path, init) => window.fetch(path.startsWith("http") ? path : "http://demo.test" + path, init);
}

test("demo page: the real dashboard with a banner, a Notis logo link and no outside requests in its own code", () => {
  assert.match(html, /<title>Notes dashboard demo — Notis<\/title>/);
  assert.match(html, /This is a demo\./);
  assert.match(html, /<a class="logo" href="\/">/);
  assert.ok(!/innerHTML/.test(html));
  assert.ok(!/__NONCE__/.test(html));
});

test("demo page: the summary and a page's notes come from invented notes in memory", async () => {
  const f = await demoServer();
  const rows = await (await f("/demo?summary=1")).json();
  assert.equal(rows.length, 4);
  assert.ok(rows.every((r) => r.url.startsWith("https://example.com/")));
  const apply = await (await f("/demo?page=" + encodeURIComponent("/permits/apply"))).json();
  assert.equal(apply.length, 3);
});

test("demo page: resolve and reply work, and a real request is not intercepted", async () => {
  const f = await demoServer();
  const res = await (await f("/demo/demoapply2", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ resolved: true }) })).json();
  assert.equal(res.resolved, true);
  const reply = await f("/demo/demoapply2/replies", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ author: "A", text: "hi" }) });
  assert.equal(reply.status, 201);
  await assert.rejects(f("https://elsewhere.example/x"), /a real request was made/);
});
