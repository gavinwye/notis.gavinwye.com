// Notis on plain Node (18 or later). Threads are JSON files in a folder, one
// file per thread. Run it behind your site's proxy, or give the widget the full
// address with `apiBase` and set COMMENTS_ALLOWED_ORIGINS.
//
//   node server/node.mjs
//
//   PORT                      port to listen on          (default 8787)
//   COMMENTS_DIR              where threads are stored   (default ./comments-data)
//   COMMENTS_ADMIN_TOKEN      guards DELETE
//   COMMENTS_ALLOWED_ORIGINS  comma-separated origins    (default: any)
import { createServer } from "node:http";
import { mkdir, readdir, readFile, writeFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createHandler } from "./core.mjs";

export function fileStorage(dir) {
  const file = (id) => join(dir, id + ".json");
  const ready = mkdir(dir, { recursive: true });
  return {
    async list() {
      await ready;
      const names = (await readdir(dir)).filter((n) => n.endsWith(".json"));
      const rows = await Promise.all(names.map((n) => readFile(join(dir, n), "utf8").then(JSON.parse).catch(() => null)));
      return rows.filter(Boolean);
    },
    async get(id) {
      await ready;
      try { return JSON.parse(await readFile(file(id), "utf8")); } catch { return null; }
    },
    async put(t) {
      await ready;
      const tmp = file(t.id) + "." + process.pid + ".tmp";
      await writeFile(tmp, JSON.stringify(t));
      await rename(tmp, file(t.id)); // replace in one step, so a crash can't leave half a file
    },
    async remove(id) {
      await ready;
      try { await rm(file(id)); return true; } catch { return false; }
    },
    async clear() {
      await ready;
      await Promise.all((await readdir(dir)).filter((n) => n.endsWith(".json")).map((n) => rm(join(dir, n))));
    },
  };
}

export function createNodeServer({ dir, adminToken, allowedOrigins, basePath } = {}) {
  const handle = createHandler({
    storage: fileStorage(dir || process.env.COMMENTS_DIR || "./comments-data"),
    config: {
      adminToken: adminToken ?? process.env.COMMENTS_ADMIN_TOKEN,
      allowedOrigins: allowedOrigins ?? (process.env.COMMENTS_ALLOWED_ORIGINS || "").split(","),
      basePath: basePath || "/api/comments",
    },
  });
  return createServer(async (nreq, nres) => {
    try {
      const chunks = [];
      let size = 0;
      for await (const c of nreq) { size += c.length; if (size > 128 * 1024) { nres.writeHead(413).end(); return; } chunks.push(c); }
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      const host = nreq.headers.host || "localhost";
      const req = new Request(`http://${host}${nreq.url}`, {
        method: nreq.method, headers: nreq.headers,
        body: body && !["GET", "HEAD"].includes(nreq.method) ? body : undefined,
      });
      const res = await handle(req);
      nres.writeHead(res.status, Object.fromEntries(res.headers));
      nres.end(Buffer.from(await res.arrayBuffer()));
    } catch (e) {
      console.error("notis error:", e);
      nres.writeHead(500).end();
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 8787);
  createNodeServer().listen(port, () => console.log(`Notis listening on :${port}`));
}
