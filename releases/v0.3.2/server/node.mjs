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
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, writeFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
// ---- Notis core (from server/core.mjs) ----
// The Notis API, with no host in it. It takes a Request and gives back a
// Response, and keeps threads through a small storage object, so the same code
// runs on Netlify, Cloudflare Workers or plain Node. Each host has a short
// adapter that supplies `storage` and the settings.
//
//   GET    {base}?page=<pageId>      -> [thread, ...]   (all threads if no page)
//   POST   {base}                    body:{pageId,quote,prefix,suffix,author,text[,pin]} -> thread
//   POST   {base}/:id/replies        body:{author,text} -> reply
//   PATCH  {base}/:id                body:{resolved} -> thread
//   DELETE {base}/:id                moderation: remove one   (admin token)
//   DELETE {base}                    moderation: remove all   (admin token)
//
// storage: {
//   list():   Promise<thread[]>
//   get(id):  Promise<thread | null>
//   put(t):   Promise<void>          create or replace one thread
//   remove(id): Promise<boolean>     true if it existed
//   clear():  Promise<void>
// }
// config: { adminToken, allowedOrigins: string[], basePath: "/api/comments" }

// Field size caps keep stored data and rendering bounded.
const LIMITS = { src: 500, alt: 200, pageId: 200, quote: 800, prefix: 200, suffix: 200, author: 80, text: 4000, replies: 1000 };
const MAX_BODY = 64 * 1024; // bytes, checked before JSON.parse
const ID = /^[a-z0-9]{6,40}$/;

const clip = (v, max) => (v == null ? "" : String(v)).slice(0, max);
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

function createHandler({ storage, config = {} }) {
  const adminToken = config.adminToken || "";
  const allowed = (config.allowedOrigins || []).map((s) => s.trim()).filter(Boolean);
  const basePath = (config.basePath || "/api/comments").replace(/\/+$/, "");
  const positiveInt = (value, fallback) => {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
  };
  const maxThreadsPerPage = positiveInt(config.maxThreadsPerPage, 500);
  const maxRepliesPerThread = positiveInt(config.maxRepliesPerThread, LIMITS.replies);
  // 0 turns the duplicate check off; anything else that isn't a positive whole number keeps the default.
  const duplicateWindowMs = String(config.duplicateWindowMs).trim() === "0" ? 0 : positiveInt(config.duplicateWindowMs, 60_000);
  const threadWrites = new Map();

  // Serialize read-modify-write operations for each thread. Without this,
  // simultaneous replies can both read the same version and one gets lost.
  const withThreadWrite = (id, task) => {
    const previous = threadWrites.get(id) || Promise.resolve();
    const current = previous.catch(() => {}).then(task);
    threadWrites.set(id, current);
    return current.finally(() => {
      if (threadWrites.get(id) === current) threadWrites.delete(id);
    });
  };

  const originAllowed = (origin) => !allowed.length || !origin || allowed.includes(origin);

  function corsHeaders(req) {
    const origin = req.headers.get("origin");
    const h = {
      "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Vary": "Origin",
      "Content-Type": "application/json",
    };
    // Only advertise an origin that is allowed, so the browser blocks the rest.
    if (!allowed.length) h["Access-Control-Allow-Origin"] = "*";
    else if (origin && allowed.includes(origin)) h["Access-Control-Allow-Origin"] = origin;
    return h;
  }

  const isAdmin = (req) => {
    if (!adminToken) return false; // no token set: moderation is off
    const auth = req.headers.get("authorization") || "";
    return (auth.startsWith("Bearer ") ? auth.slice(7) : "") === adminToken;
  };

  async function readJson(req) {
    const len = Number(req.headers.get("content-length") || 0);
    if (len && len > MAX_BODY) return { ok: false, tooLarge: true };
    let text;
    try { text = await req.text(); } catch { return { ok: false }; }
    if (text.length > MAX_BODY) return { ok: false, tooLarge: true };
    try { return { ok: true, value: JSON.parse(text) }; } catch { return { ok: false }; }
  }

  return async function handle(req) {
    const cors = corsHeaders(req);
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: cors });
    const badBody = (p) => json({ error: p.tooLarge ? "payload too large" : "invalid JSON" }, p.tooLarge ? 413 : 400);

    // A 204 has to carry a null body.
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (!originAllowed(req.headers.get("origin"))) return json({ error: "forbidden origin" }, 403);

    const url = new URL(req.url);
    if (url.pathname !== basePath && !url.pathname.startsWith(basePath + "/")) return json({ error: "not found" }, 404);
    let seg;
    try {
      seg = url.pathname.slice(basePath.length).split("/").filter(Boolean).map(decodeURIComponent);
    } catch {
      return json({ error: "invalid path encoding" }, 400);
    }
    if (seg[0] !== undefined && !ID.test(seg[0])) return json({ error: "thread not found" }, 404);

    try {
      // ---- GET ?page= ----
      if (req.method === "GET" && seg.length === 0) {
        const page = url.searchParams.get("page");
        if (!page && !isAdmin(req)) return json({ error: "admin token required to list all pages" }, 403);
        const all = await storage.list();
        const out = (page ? all.filter((t) => t.pageId === page) : all)
          .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
        return json(out);
      }

      // ---- POST (create a thread) ----
      if (req.method === "POST" && seg.length === 0) {
        const parsed = await readJson(req);
        if (!parsed.ok) return badBody(parsed);
        const b = parsed.value || {};
        const pageId = clip(b.pageId, LIMITS.pageId).trim();
        const text = clip(b.text, LIMITS.text).trim();
        if (!pageId) return json({ error: "pageId is required" }, 400);
        if (!text) return json({ error: "text is required" }, 400);

        // A pin is a point on an image: its src and place in the page, plus x/y
        // as fractions (0 to 1) of the image, so it survives resizing.
        let pin;
        if (b.pin && typeof b.pin === "object") {
          const x = Number(b.pin.x), y = Number(b.pin.y), i = Number(b.pin.i);
          if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) {
            return json({ error: "pin x and y must be between 0 and 1" }, 400);
          }
          const src = clip(b.pin.src, LIMITS.src).trim();
          if (!src) return json({ error: "pin src is required" }, 400);
          pin = { src, alt: clip(b.pin.alt, LIMITS.alt), i: Number.isInteger(i) && i >= 0 && i < 10000 ? i : 0, x, y };
        }

        return withThreadWrite(`page:${pageId}`, async () => {
          const author = clip(b.author, LIMITS.author).trim() || "Anonymous";
          const existing = (await storage.list()).filter((thread) => thread.pageId === pageId);
          if (existing.length >= maxThreadsPerPage) return json({ error: "too many threads on this page" }, 429);
          // The same person saying the same thing about the same words (or the same spot on an image)
          // within the window is a double submit. The same remark on different words is not.
          const duplicate = duplicateWindowMs > 0 && existing.some((thread) => thread.author === author && thread.text === text &&
            thread.quote === clip(b.quote, LIMITS.quote) && JSON.stringify(thread.pin || null) === JSON.stringify(pin || null) &&
            Date.now() - Number(thread.createdAt || 0) < duplicateWindowMs);
          if (duplicate) return json({ error: "duplicate comment" }, 409);

          const thread = {
            id: newId(), pageId,
            quote: clip(b.quote, LIMITS.quote),
            prefix: clip(b.prefix, LIMITS.prefix),
            suffix: clip(b.suffix, LIMITS.suffix),
            author, text,
            ...(pin ? { pin } : {}),
            createdAt: Date.now(), resolved: false, replies: [],
          };
          await storage.put(thread);
          return json(thread, 201);
        });
      }

      // ---- POST /:id/replies ----
      if (req.method === "POST" && seg.length === 2 && seg[1] === "replies") {
        const parsed = await readJson(req);
        if (!parsed.ok) return badBody(parsed);
        const text = clip((parsed.value || {}).text, LIMITS.text).trim();
        if (!text) return json({ error: "text is required" }, 400);
        return withThreadWrite(seg[0], async () => {
          const t = await storage.get(seg[0]);
          if (!t) return json({ error: "thread not found" }, 404);
          if (!Array.isArray(t.replies)) t.replies = [];
          if (t.replies.length >= maxRepliesPerThread) return json({ error: "too many replies" }, 429);
          const author = clip((parsed.value || {}).author, LIMITS.author).trim() || "Anonymous";
          const duplicate = duplicateWindowMs > 0 && t.replies.some((reply) => reply.author === author && reply.text === text &&
            Date.now() - Number(reply.createdAt || 0) < duplicateWindowMs);
          if (duplicate) return json({ error: "duplicate reply" }, 409);
          const reply = {
            id: newId(),
            author,
            text,
            createdAt: Date.now(),
          };
          t.replies.push(reply);
          await storage.put(t);
          return json(reply, 201);
        });
      }

      // ---- PATCH /:id (resolve or reopen only) ----
      if (req.method === "PATCH" && seg.length === 1) {
        const parsed = await readJson(req);
        if (!parsed.ok) return badBody(parsed);
        const body = parsed.value || {};
        if (typeof body.resolved !== "boolean") return json({ error: "resolved (boolean) is required" }, 400);
        return withThreadWrite(seg[0], async () => {
          const t = await storage.get(seg[0]);
          if (!t) return json({ error: "thread not found" }, 404);
          t.resolved = body.resolved;
          await storage.put(t);
          return json(t);
        });
      }

      // ---- DELETE (moderation) ----
      if (req.method === "DELETE") {
        if (!isAdmin(req)) return json({ error: "forbidden" }, 403);
        // Only the bare base path clears everything. A trailing slash or an empty
        // segment (what a script sends when its $ID is unset) is refused, so a
        // mistake can't wipe the store.
        const rest = url.pathname.slice(basePath.length);
        if (rest === "") { await storage.clear(); return json({ ok: true, cleared: true }); }
        const one = rest.endsWith("/") ? rest.slice(0, -1) : rest; // one trailing slash after an id is harmless
        if (seg.length !== 1 || !/^\/[^/]+$/.test(one) || one.slice(1).trim() === "") {
          return json({ error: "a note id is required; to clear all notes use DELETE " + basePath }, 400);
        }
        return json({ ok: true, removed: (await storage.remove(seg[0])) ? 1 : 0 });
      }

      return json({ error: "unsupported", method: req.method }, 400);
    } catch (e) {
      console.error("notis error:", e);
      return json({ error: "internal error" }, 500);
    }
  };
}

// A simple in-memory store for tests and demos.
function memoryStorage() {
  const m = new Map();
  const copy = (t) => JSON.parse(JSON.stringify(t));
  return {
    list: async () => [...m.values()].map(copy),
    get: async (id) => (m.has(id) ? copy(m.get(id)) : null),
    put: async (t) => { m.set(t.id, copy(t)); },
    remove: async (id) => m.delete(id),
    clear: async () => { m.clear(); },
  };
}

// ---- end of core ----

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
      const tmp = file(t.id) + "." + process.pid + "." + randomUUID() + ".tmp";
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
      maxThreadsPerPage: process.env.COMMENTS_MAX_THREADS_PER_PAGE,
      maxRepliesPerThread: process.env.COMMENTS_MAX_REPLIES_PER_THREAD,
      duplicateWindowMs: process.env.COMMENTS_DUPLICATE_WINDOW_MS,
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
