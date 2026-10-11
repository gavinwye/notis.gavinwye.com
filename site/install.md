# Add Notis to a site

Notis lets reviewers select text on a page, or drop a pin on an image, and leave a note. Everyone who opens the page sees the same notes. Home: https://notis.gavinwye.com. Source: https://github.com/gavinwye/notis.gavinwye.com (MIT).

You are an AI agent adding Notis to the user's site. Follow these steps in order. Ask the user before step 5, and before anything that deploys to production.

## 1. Decide where it should run

Ask, or work out from the repo:

- **Reviewers only (recommended).** Load it on preview builds or behind a password. This is what Notis is for.
- **Everywhere.** Only if the user says so. Anyone who can load the page can leave a note, with no sign-in.

If the site has a preview or staging build, wire it there. If there's only production, say so and ask.

## 2. Get the script

Find the current version and its hash at https://notis.gavinwye.com/version.json:

```json
{ "version": "0.3.0",
  "script": "https://notis.gavinwye.com/v0.3.0/comments.js",
  "integrity": "sha384-zBFcKQGAPWicStoMgHXnnyyqshoLQQG6d6go9c5XQ1c9/rsXEowFE0twoWjJStln",
  "snippet": "https://notis.gavinwye.com/v0.3.0/snippet.html" }
```

Everything under `/v<version>/` is immutable: the same address always returns the same bytes. The unversioned `/comments.js` changes when a new version is released, so don't point a site at it.

**If the site has a folder for static files (`public/`, `static/`, the site root), save a copy there**, so it's served at `/comments.js`. Use the versioned file and check it against the hash:

```bash
curl -fsSL https://notis.gavinwye.com/v0.3.0/comments.js -o <static dir>/comments.js
curl -fsSL https://notis.gavinwye.com/v0.3.0/comments.js.sri
# the second command's output should equal:
openssl dgst -sha384 -binary <static dir>/comments.js | openssl base64 -A
```

Commit the file, and say in your report which version you saved.

**If you're adding the script from the web instead** (a page you can edit but that has no static folder, a CMS, a hosted page builder), use the versioned URL with its integrity hash. Take the tag from `snippet`, never the unversioned URL:

```html
<script src="https://notis.gavinwye.com/v0.3.0/comments.js" integrity="sha384-zBFcKQGAPWicStoMgHXnnyyqshoLQQG6d6go9c5XQ1c9/rsXEowFE0twoWjJStln" crossorigin="anonymous" defer></script>
```

With this form, that tag is the script tag, so skip the `<script src="/comments.js">` line in step 3. Everything else is the same.

## 3. Add one line to the page template

Before the closing `</body>` in the shared layout (one place, not every page):

```html
<script src="/comments.js" defer></script>
```

| Site type | Where |
|---|---|
| Plain HTML | each page, or the shared include |
| Astro | the main layout in `src/layouts/` |
| Next.js | `app/layout.tsx`: `<Script src="/comments.js" strategy="afterInteractive" />` from `next/script` |
| Eleventy, Hugo, Jekyll | the base layout |
| Vite, React | `index.html` |

If it should only run on previews, put the tag behind the build or environment check the site already has. Don't invent a new one.

## 4. Choose where notes are stored

Work out the host from the repo (a `netlify.toml`, a `wrangler.toml`, a Dockerfile, a plain server) and offer the matching row. If you can't tell, ask.

| Option | Use when | File to download |
|---|---|---|
| **Browser only** | A quick demo. Comments aren't shared. | none. Add `<script>window.COMMENTS_CONFIG = { apiBase: null };</script>` before the script tag |
| **Netlify** | The site is on Netlify. | `https://notis.gavinwye.com/server/netlify.mjs` |
| **Cloudflare Workers** | The site is on Cloudflare. | `https://notis.gavinwye.com/server/cloudflare.mjs` |
| **Node** | A server, a VPS, Docker, Fly, Railway. | `https://notis.gavinwye.com/server/node.mjs` |
| **Something else** | Vercel, static hosting, and so on | Run the Node file somewhere, and set `apiBase` to its address. Tell the user it needs a small always-on server. |

## 5. Set up the server

Ask the user first. This adds a function or a service and a secret.

**Netlify**

```bash
mkdir -p netlify/functions
curl -fsSL https://notis.gavinwye.com/server/netlify.mjs -o netlify/functions/comments.mjs
npm install @netlify/blobs
```

**Cloudflare Workers**

```bash
curl -fsSL https://notis.gavinwye.com/server/cloudflare.mjs -o cloudflare.mjs
wrangler kv namespace create COMMENTS   # note the id it prints
```

Add the binding and a route for `<site>/api/comments*` to `wrangler.toml` (the README has an example), then `wrangler secret put COMMENTS_ADMIN_TOKEN` and `wrangler deploy`.

**Node**

```bash
curl -fsSL https://notis.gavinwye.com/server/node.mjs -o notis-server.mjs
COMMENTS_ADMIN_TOKEN=... COMMENTS_DIR=/data node notis-server.mjs
```

Needs Node 18 or later and a folder that persists. If it's on a different address from the site, set `apiBase` to the full address (for example `https://notis.example.com/api`) and `COMMENTS_ALLOWED_ORIGINS` to the site's origin.

**Settings** (as environment variables, or secrets on the host, never in the repo):

| Variable | Value |
|---|---|
| `COMMENTS_ADMIN_TOKEN` | a long random string, for example `openssl rand -hex 32`. Guards deleting comments. |
| `COMMENTS_ALLOWED_ORIGINS` | the site's origins, comma separated. |
| `COMMENTS_STORE` | Netlify only, optional. A different store name for each site. |

Never print, log or commit the token. If you can't set it yourself, tell the user the variable names and stop.

Preview deploys need the function too, so check it's included in the build, not only production.

## Where the notes end up

They are kept on the user's own host: Netlify Blobs (store `COMMENTS_STORE`, default `comments`), their Cloudflare KV namespace, or the folder `COMMENTS_DIR` for Node. On Netlify, production and deploy previews share the store, so use a different `COMMENTS_STORE` for each site. Tell the user where they are when you report back. Anyone with the admin token can export them with `curl -H "Authorization: Bearer $COMMENTS_ADMIN_TOKEN" <site>/api/comments`.

## 6. Check it works

1. Open the page, select a sentence, click Add note, add a name and a note.
2. Reload. The highlight and the note should still be there.
3. For shared storage, `curl <site>/api/comments` returns JSON containing the comment.
   If something doesn't work, the user can report it at https://github.com/gavinwye/notis.gavinwye.com/issues/new?template=bug_report.yml. Give them the output of `NotisVersion` in the browser console and which host they chose.
4. Open the page in a private window. The note should be there too.

Report back with what you changed, what you checked, and anything the user must do (for example, setting the token).

## Options

Set before the script, or as `data-*` attributes on the tag:

| Option | Default | What it does |
|---|---|---|
| `apiBase` | `"/api"` | Where the API lives. `null` keeps notes in the browser only. |
| `pageId` | the URL path | Pages with the same value share notes. |
| `root` | `"body"` | CSS selector for the region people can leave notes on. |
| `dock` | `false` | Push the page over to make room for the panel. |
| `pins` | `true` | Allow pins on images. |
| `noun` | `"note"` | What things left on the page are called on screen. Set `"comment"` for Comments and Add a comment. |

## Reading the notes

```bash
curl -s "<site>/api/comments?page=<pageId>"
```

Each thread has `quote` (the words), `text` (the note), `resolved`, and `replies`. A pinned thread has `pin` instead of a quote. To mark one done, `PATCH /api/comments/<id>` with `{"resolved": true}`.
