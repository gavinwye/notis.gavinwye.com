// Notis on Netlify. Threads live in a Netlify Blobs store in your own account:
// one blob per thread, under the key `t/<id>`.
//
//   COMMENTS_STORE            store name                (default "comments")
//   COMMENTS_ADMIN_TOKEN      guards DELETE
//   COMMENTS_ALLOWED_ORIGINS  comma-separated origins   (default: any)
//   COMMENTS_DASHBOARD        "public" lets anyone read the dashboard summary (default: admin token only)
import { getStore } from "@netlify/blobs";
import { createHandler } from "./core.mjs";

export const config = {
  path: ["/api/comments", "/api/comments/dashboard", "/api/comments/:id", "/api/comments/:id/replies"],
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
        maxThreadsPerPage: process.env.COMMENTS_MAX_THREADS_PER_PAGE,
        maxRepliesPerThread: process.env.COMMENTS_MAX_REPLIES_PER_THREAD,
        duplicateWindowMs: process.env.COMMENTS_DUPLICATE_WINDOW_MS,
        dashboard: process.env.COMMENTS_DASHBOARD,
        basePath: "/api/comments",
      },
    });
  }
  return handler(req);
};
