import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNodeServer } from "../server/node.mjs";

test("node adapter: a thread survives a restart, one file per thread", async () => {
  const dir = await mkdtemp(join(tmpdir(), "notis-"));
  const start = () => new Promise((res) => { const s = createNodeServer({ dir, adminToken: "tok" }); s.listen(0, () => res(s)); });
  let s = await start();
  const base = () => `http://127.0.0.1:${s.address().port}/api/comments`;
  const created = await (await fetch(base(), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pageId: "/a", quote: "q", text: "hello", author: "Sam" }) })).json();
  assert.ok(created.id);
  const replies = await Promise.all(Array.from({ length: 20 }, (_, i) => fetch(`${base()}/${created.id}/replies`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: `reply ${i}` }),
  })));
  assert.ok(replies.every((response) => response.status === 201));
  await new Promise((r) => s.close(r));
  assert.equal((await readdir(dir)).filter((n) => n.endsWith(".json")).length, 1);

  s = await start();
  const list = await (await fetch(`${base()}?page=/a`)).json();
  assert.equal(list.length, 1);
  assert.equal(list[0].replies.length, 20);
  assert.equal((await fetch(`${base()}/${created.id}`, { method: "DELETE" })).status, 403);
  assert.equal((await fetch(`${base()}/${created.id}`, { method: "DELETE", headers: { authorization: "Bearer tok" } })).status, 200);
  await new Promise((r) => s.close(r));
  await rm(dir, { recursive: true });
});
