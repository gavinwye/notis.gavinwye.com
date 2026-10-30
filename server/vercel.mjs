// Notis on Vercel. Threads live in a private Vercel Blob store, one JSON blob
// per thread under `notis/t/<id>.json`.
//
// Connect a private Blob store to the project so Vercel sets BLOB_READ_WRITE_TOKEN.
// Copy this file to api/comments.js (or route every /api/comments* request to it).
import { get, list, put, del } from "@vercel/blob";
import { createHandler } from "./core.mjs";

const PREFIX = "notis/t/";
const key = (id) => `${PREFIX}${id}.json`;

export function storageFor(blob) {
  async function blobs() {
    const out = [];
    let cursor;
    do {
      const page = await blob.list({ prefix: PREFIX, cursor });
      out.push(...page.blobs);
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return out;
  }

  async function read(pathname) {
    try {
      const result = await blob.get(pathname, { access: "private", useCache: false });
      return result ? await new Response(result.stream).json() : null;
    } catch (error) {
      if (error && (error.name === "BlobNotFoundError" || error.status === 404)) return null;
      throw error;
    }
  }

  return {
    async list() {
      const rows = await Promise.all((await blobs()).map((item) => read(item.pathname)));
      return rows.filter(Boolean);
    },
    get: (id) => read(key(id)),
    async put(thread) {
      await blob.put(key(thread.id), JSON.stringify(thread), {
        access: "private",
        allowOverwrite: true,
        contentType: "application/json",
        cacheControlMaxAge: 60,
      });
    },
    async remove(id) {
      const pathname = key(id);
      const had = await read(pathname);
      if (had) await blob.del(pathname);
      return Boolean(had);
    },
    async clear() {
      const paths = (await blobs()).map((item) => item.pathname);
      if (paths.length) await blob.del(paths);
    },
  };
}

let handler;
export default function vercelHandler(request) {
  handler ??= createHandler({
    storage: storageFor({ get, list, put, del }),
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
  return handler(request);
}
