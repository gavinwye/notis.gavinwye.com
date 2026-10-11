// Notis on Netlify. Threads live in a Netlify Blobs store in your own account:
// one blob per thread, under the key `t/<id>`.
//
//   COMMENTS_STORE            store name                (default "comments")
//   COMMENTS_ADMIN_TOKEN      guards DELETE
//   COMMENTS_ALLOWED_ORIGINS  comma-separated origins   (default: any)
import { getStore } from "@netlify/blobs";
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
    const seg = url.pathname.slice(basePath.length).split("/").filter(Boolean).map(decodeURIComponent);
    if (seg[0] !== undefined && !ID.test(seg[0])) return json({ error: "thread not found" }, 404);

    try {
      // ---- GET ?page= ----
      if (req.method === "GET" && seg.length === 0) {
        const all = await storage.list();
        const page = url.searchParams.get("page");
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

        // The server owns id, createdAt, resolved and replies.
        const thread = {
          id: newId(), pageId,
          quote: clip(b.quote, LIMITS.quote),
          prefix: clip(b.prefix, LIMITS.prefix),
          suffix: clip(b.suffix, LIMITS.suffix),
          author: clip(b.author, LIMITS.author).trim() || "Anonymous",
          text,
          ...(pin ? { pin } : {}),
          createdAt: Date.now(), resolved: false, replies: [],
        };
        await storage.put(thread);
        return json(thread, 201);
      }

      // ---- POST /:id/replies ----
      if (req.method === "POST" && seg.length === 2 && seg[1] === "replies") {
        const parsed = await readJson(req);
        if (!parsed.ok) return badBody(parsed);
        const text = clip((parsed.value || {}).text, LIMITS.text).trim();
        if (!text) return json({ error: "text is required" }, 400);
        const t = await storage.get(seg[0]);
        if (!t) return json({ error: "thread not found" }, 404);
        if (!Array.isArray(t.replies)) t.replies = [];
        if (t.replies.length >= LIMITS.replies) return json({ error: "too many replies" }, 400);
        const reply = {
          id: newId(),
          author: clip((parsed.value || {}).author, LIMITS.author).trim() || "Anonymous",
          text,
          createdAt: Date.now(),
        };
        t.replies.push(reply);
        await storage.put(t);
        return json(reply, 201);
      }

      // ---- PATCH /:id (resolve or reopen only) ----
      if (req.method === "PATCH" && seg.length === 1) {
        const parsed = await readJson(req);
        if (!parsed.ok) return badBody(parsed);
        const body = parsed.value || {};
        if (typeof body.resolved !== "boolean") return json({ error: "resolved (boolean) is required" }, 400);
        const t = await storage.get(seg[0]);
        if (!t) return json({ error: "thread not found" }, 404);
        t.resolved = body.resolved;
        await storage.put(t);
        return json(t);
      }

      // ---- DELETE (moderation) ----
      if (req.method === "DELETE") {
        if (!isAdmin(req)) return json({ error: "forbidden" }, 403);
        if (seg.length === 0) { await storage.clear(); return json({ ok: true, cleared: true }); }
        if (seg.length === 1) return json({ ok: true, removed: (await storage.remove(seg[0])) ? 1 : 0 });
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

export const config = {
  path: ["/api/comments", "/api/comments/:id", "/api/comments/:id/replies"],
};

const PREFIX = "t/";
const LEGACY_KEY = "threads"; // older versions kept every thread in one blob

export function storageFor(store) {
  const keys = async () => (await store.list({ prefix: PREFIX })).blobs.map((b) => b.key);

  // Move a legacy single blob into one blob per thread. Safe to repeat.
  async function migrate() {
    const old = await store.get(LEGACY_KEY, { type: "json" });
    if (!Array.isArray(old)) return;
    await Promise.all(old.filter((t) => t && t.id).map((t) => store.setJSON(PREFIX + t.id, t)));
    await store.delete(LEGACY_KEY);
  }

  return {
    async list() {
      await migrate();
      const rows = await Promise.all((await keys()).map((k) => store.get(k, { type: "json" })));
      return rows.filter(Boolean);
    },
    get: async (id) => (await store.get(PREFIX + id, { type: "json" })) || null,
    put: async (t) => { await store.setJSON(PREFIX + t.id, t); },
    async remove(id) {
      const had = await store.get(PREFIX + id, { type: "json" });
      if (had) await store.delete(PREFIX + id);
      return Boolean(had);
    },
    async clear() { await Promise.all((await keys()).map((k) => store.delete(k))); },
  };
}

let handler;
export default async (req) => {
  if (!handler) {
    handler = createHandler({
      storage: storageFor(getStore({ name: process.env.COMMENTS_STORE || "comments", consistency: "strong" })),
      config: {
        adminToken: process.env.COMMENTS_ADMIN_TOKEN,
        allowedOrigins: (process.env.COMMENTS_ALLOWED_ORIGINS || "").split(","),
        basePath: "/api/comments",
      },
    });
  }
  return handler(req);
};
