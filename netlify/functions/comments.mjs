import { getStore } from "@netlify/blobs";

// Serves the comment-widget API contract (matches public/comments.js ApiStore):
//   GET    /api/comments?page=<pageId>          -> [thread, ...]
//   POST   /api/comments            body:{pageId,quote,prefix,suffix,author,text[,pin]} -> thread
//   POST   /api/comments/:id/replies body:{author,text} -> reply
//   PATCH  /api/comments/:id        body:{resolved} -> thread
//   DELETE /api/comments/:id                    -> moderation (remove one)
//   DELETE /api/comments                        -> moderation (reset all)
//
// DELETE requires an admin token: send `Authorization: Bearer <token>`.
// (Query-string tokens are intentionally NOT accepted — they leak into logs,
// browser history and referrers.)
//
// Config via environment variables (Netlify → Site settings → Env, and a
// local .env for `netlify dev` — see .env.example):
//   COMMENTS_STORE            blob store name             (default "comments")
//   COMMENTS_ADMIN_TOKEN      guards DELETE — REQUIRED for moderation; if unset,
//                             all DELETEs are refused (fail closed)
//   COMMENTS_ALLOWED_ORIGINS  comma-separated CORS allowlist; if unset, "*"
export const config = {
  path: ["/api/comments", "/api/comments/:id", "/api/comments/:id/replies"],
};

const KEY = "threads"; // single blob holding all threads (each carries its own pageId)
const STORE = process.env.COMMENTS_STORE || "comments";
const ALLOWED = (process.env.COMMENTS_ALLOWED_ORIGINS || "")
  .split(",").map((s) => s.trim()).filter(Boolean);

// Field size caps — keep stored blobs and rendering bounded.
const LIMITS = { src: 500, alt: 200, pageId: 200, quote: 800, prefix: 200, suffix: 200, author: 80, text: 4000, replies: 1000 };
const MAX_BODY = 64 * 1024; // hard cap on request body bytes, enforced before JSON.parse

const clip = (v, max) => (v == null ? "" : String(v)).slice(0, max);
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

function originAllowed(origin) {
  if (!ALLOWED.length) return true; // no allowlist configured => open
  if (!origin) return true;         // non-CORS request (curl, same-origin) — CORS doesn't apply
  return ALLOWED.includes(origin);
}
function corsHeaders(req) {
  const origin = req.headers.get("origin");
  const h = {
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Vary": "Origin",
    "Content-Type": "application/json",
  };
  // Only advertise ACAO for an allowed origin; otherwise omit it so the browser blocks the response.
  if (!ALLOWED.length) h["Access-Control-Allow-Origin"] = "*";
  else if (origin && ALLOWED.includes(origin)) h["Access-Control-Allow-Origin"] = origin;
  return h;
}

function isAdmin(req, url) {
  const tok = process.env.COMMENTS_ADMIN_TOKEN;
  if (!tok) return false; // fail closed: no token configured => no moderation
  const auth = req.headers.get("authorization") || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  return bearer === tok;
}

async function readJson(req) {
  const len = Number(req.headers.get("content-length") || 0);
  if (len && len > MAX_BODY) return { ok: false, tooLarge: true };
  let text;
  try { text = await req.text(); } catch { return { ok: false }; }
  if (text.length > MAX_BODY) return { ok: false, tooLarge: true };
  try { return { ok: true, value: JSON.parse(text) }; }
  catch { return { ok: false }; }
}

export default async (req) => {
  const cors = corsHeaders(req);
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: cors });

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

  // Reject cross-origin requests from origins outside the allowlist (server-side,
  // not just via missing ACAO). Requests with no Origin header are same-origin/curl.
  if (!originAllowed(req.headers.get("origin"))) return json({ error: "forbidden origin" }, 403);

  const store = getStore({ name: STORE, consistency: "strong" });
  const url = new URL(req.url);
  const rest = url.pathname.replace(/^\/api\/comments\/?/, "").replace(/\/$/, "");
  const seg = rest ? rest.split("/") : [];

  try {
    const all = (await store.get(KEY, { type: "json" })) || [];

    // ---- GET /api/comments?page= ----
    if (req.method === "GET" && seg.length === 0) {
      const page = url.searchParams.get("page");
      return json(page ? all.filter((t) => t.pageId === page) : all);
    }

    // ---- POST /api/comments (create thread) ----
    if (req.method === "POST" && seg.length === 0) {
      const parsed = await readJson(req);
      if (!parsed.ok) return json({ error: parsed.tooLarge ? "payload too large" : "invalid JSON" }, parsed.tooLarge ? 413 : 400);
      const b = parsed.value || {};
      const pageId = clip(b.pageId, LIMITS.pageId).trim();
      const text = clip(b.text, LIMITS.text).trim();
      if (!pageId) return json({ error: "pageId is required" }, 400);
      if (!text) return json({ error: "text is required" }, 400);
      // A pin is a point on an image: the image's src and position in the page,
      // plus x/y as fractions (0 to 1) of the image, so it survives resizing.
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
      // Server owns id/createdAt/resolved/replies — client-supplied values are ignored.
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
      all.push(thread);
      await store.setJSON(KEY, all);
      return json(thread, 201);
    }

    // ---- POST /api/comments/:id/replies ----
    if (req.method === "POST" && seg.length === 2 && seg[1] === "replies") {
      const id = decodeURIComponent(seg[0]);
      const parsed = await readJson(req);
      if (!parsed.ok) return json({ error: parsed.tooLarge ? "payload too large" : "invalid JSON" }, parsed.tooLarge ? 413 : 400);
      const b = parsed.value || {};
      const text = clip(b.text, LIMITS.text).trim();
      if (!text) return json({ error: "text is required" }, 400);
      const t = all.find((x) => x.id === id);
      if (!t) return json({ error: "thread not found" }, 404);
      if (!Array.isArray(t.replies)) t.replies = [];
      if (t.replies.length >= LIMITS.replies) return json({ error: "too many replies" }, 400);
      const reply = {
        id: newId(),
        author: clip(b.author, LIMITS.author).trim() || "Anonymous",
        text,
        createdAt: Date.now(),
      };
      t.replies.push(reply);
      await store.setJSON(KEY, all);
      return json(reply, 201);
    }

    // ---- PATCH /api/comments/:id (resolve/reopen only) ----
    if (req.method === "PATCH" && seg.length === 1) {
      const id = decodeURIComponent(seg[0]);
      const parsed = await readJson(req);
      if (!parsed.ok) return json({ error: parsed.tooLarge ? "payload too large" : "invalid JSON" }, parsed.tooLarge ? 413 : 400);
      const body = parsed.value || {};
      const t = all.find((x) => x.id === id);
      if (!t) return json({ error: "thread not found" }, 404);
      if (typeof body.resolved !== "boolean") return json({ error: "resolved (boolean) is required" }, 400);
      t.resolved = body.resolved; // PATCH only toggles resolved; replies are immutable here
      await store.setJSON(KEY, all);
      return json(t);
    }

    // ---- DELETE (moderation) ----
    if (req.method === "DELETE") {
      if (!isAdmin(req, url)) return json({ error: "forbidden" }, 403);
      if (seg.length === 0) { await store.setJSON(KEY, []); return json({ ok: true, cleared: true }); }
      if (seg.length === 1) {
        const id = decodeURIComponent(seg[0]);
        const next = all.filter((t) => t.id !== id);
        await store.setJSON(KEY, next);
        return json({ ok: true, removed: all.length - next.length });
      }
    }

    return json({ error: "unsupported", method: req.method, seg }, 400);
  } catch (e) {
    // Unexpected failures only — client errors are handled above with 400/404.
    console.error("comments function error:", e);
    return json({ error: "internal error" }, 500);
  }
};
