// Notis on Cloudflare Workers. Threads live in a Workers KV namespace bound as
// COMMENTS, one key per thread (`t:<id>`).
//
//   binding COMMENTS            a KV namespace
//   COMMENTS_ADMIN_TOKEN        guards DELETE (a secret)
//   COMMENTS_ALLOWED_ORIGINS    comma-separated origins (default: any)
//
// Serve it on the same hostname as the site, for example the route
// example.com/api/comments*, so the widget's default "/api" works.
import { createHandler } from "./core.mjs";

const PREFIX = "t:";

export function storageFor(kv) {
  async function keys() {
    const out = [];
    let cursor;
    do {
      const page = await kv.list({ prefix: PREFIX, cursor });
      out.push(...page.keys.map((k) => k.name));
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
    return out;
  }
  return {
    async list() {
      const rows = await Promise.all((await keys()).map((k) => kv.get(k, "json")));
      return rows.filter(Boolean);
    },
    get: async (id) => (await kv.get(PREFIX + id, "json")) || null,
    put: async (t) => { await kv.put(PREFIX + t.id, JSON.stringify(t)); },
    async remove(id) {
      const had = await kv.get(PREFIX + id, "json");
      if (had) await kv.delete(PREFIX + id);
      return Boolean(had);
    },
    async clear() { await Promise.all((await keys()).map((k) => kv.delete(k))); },
  };
}

// Built once per isolate. The per-thread write queue lives inside the handler, so making a new
// handler for every request (as this file used to) would give each request its own empty queue.
let handle;

export default {
  fetch(req, env) {
    handle ??= createHandler({
      storage: storageFor(env.COMMENTS),
      config: {
        adminToken: env.COMMENTS_ADMIN_TOKEN,
        allowedOrigins: (env.COMMENTS_ALLOWED_ORIGINS || "").split(","),
        maxThreadsPerPage: env.COMMENTS_MAX_THREADS_PER_PAGE,
        maxRepliesPerThread: env.COMMENTS_MAX_REPLIES_PER_THREAD,
        duplicateWindowMs: env.COMMENTS_DUPLICATE_WINDOW_MS,
        basePath: "/api/comments",
      },
    });
    return handle(req);
  },
};
