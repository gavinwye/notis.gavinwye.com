# Add Notis to a site

Notis lets reviewers select text on a page, or drop a pin on an image, and leave a note. Everyone who opens the page sees the same notes. Home: https://notis.gavinwye.com. Source: https://github.com/gavinwye/notis.gavinwye.com (MIT).

You are an AI agent adding Notis to the user's site. Follow these steps in order. Ask the user before step 5, and before anything that deploys to production.

## 1. Decide where it should run

Ask, or work out from the repo:

- **Reviewers only (recommended).** Load it on preview builds or behind a password. This is what Notis is for.
- **Everywhere.** Only if the user says so. Anyone who can load the page can leave a note, with no sign-in.

If the site has a preview or staging build, wire it there. If there's only production, say so and ask.

## 2. Get the script

Read the current version and its hash from https://notis.gavinwye.com/version.json. Use the values it returns, not the ones in this example:

```json
{ "version": "0.3.1",
  "script": "https://notis.gavinwye.com/v0.3.1/comments.js",
  "integrity": "sha384-O1JkOvtU6pF5DrL2wz0QKOsFJ2PznDX1e9ltLKMkvpAU6K23JvK/OtFatbqlw7DA",
  "snippet": "https://notis.gavinwye.com/v0.3.1/snippet.html",
  "servers": {
    "netlify": "https://notis.gavinwye.com/v0.3.1/server/netlify.mjs",
    "cloudflare": "https://notis.gavinwye.com/v0.3.1/server/cloudflare.mjs",
    "node": "https://notis.gavinwye.com/v0.3.1/server/node.mjs" } }
```

Everything under `/v<version>/` is immutable: the same address always returns the same bytes. The unversioned `/comments.js` changes when a new version is released, so don't point a site at it.

### Default: a copy on the user's own site

Save the file into the site's folder for static files (`public/`, `static/`, the site root), so it's served at `/comments.js` from the user's own server. Visitors then never contact the Notis site, and the user decides when to update. Use the versioned file and check it against the hash:

```bash
curl -fsSL https://notis.gavinwye.com/v<version>/comments.js -o <static dir>/comments.js
curl -fsSL https://notis.gavinwye.com/v<version>/comments.js.sri
# the second command's output is "sha384-" followed by the same text as:
openssl dgst -sha384 -binary <static dir>/comments.js | openssl base64 -A
```

If `openssl` isn't installed (it often isn't on Windows), this prints the same value with Node:

```bash
node -e "console.log(require('crypto').createHash('sha384').update(require('fs').readFileSync(process.argv[1])).digest('base64'))" <static dir>/comments.js
```

If the two don't match, stop and say so. Commit the file, and say in your report which version you saved.

### Second choice: load it from the Notis site

Only for a quick try, or where there is no static folder (a CMS, a hosted page builder). **Not recommended for production:** every visitor's browser then fetches the file from notis.gavinwye.com, so the site depends on it being up and the Notis site sees each visitor's request. Use the versioned address with its integrity hash, taken from `snippet`, never the unversioned one:

```html
<script src="https://notis.gavinwye.com/v<version>/comments.js" integrity="sha384-<hash from version.json>" crossorigin="anonymous" defer></script>
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
| **Browser only** | A quick demo. Notes aren't shared: each browser keeps its own. | none. Add `<script>window.COMMENTS_CONFIG = { apiBase: null };</script>` before the script tag |
| **Netlify** | The site is on Netlify. | `servers.netlify` from version.json |
| **Cloudflare Workers** | The site is on Cloudflare. | `servers.cloudflare` from version.json |
| **Vercel** | The site is on Vercel. | `servers.vercel` from version.json |
| **Node** | A server, a VPS, Docker, Fly, Railway. | `servers.node` from version.json |
| **Something else** | Static hosting without functions, and so on | Run the Node file somewhere, and set `apiBase` to its address. Tell the user it needs a small always-on server. |

## 5. Set up the server

Ask the user first. This adds a function or a service and a secret.

**Netlify**

```bash
mkdir -p netlify/functions
curl -fsSL https://notis.gavinwye.com/v<version>/server/netlify.mjs -o netlify/functions/comments.mjs
npm install @netlify/blobs
```

`npm install` creates a `package.json` if the folder doesn't have one, which is fine; commit it. To try it before deploying, put the settings in a `.env` file next to `netlify.toml` (never commit it) and run `netlify dev`. One quirk in `netlify dev` only: a request to list all pages without the token shows `404 thread not found` instead of `403`. The deployed function answers `403`.

**Cloudflare Workers**

```bash
curl -fsSL https://notis.gavinwye.com/v<version>/server/cloudflare.mjs -o cloudflare.mjs
wrangler kv namespace create COMMENTS   # note the id it prints
```

Create `wrangler.toml` next to it, with the id that `wrangler kv namespace create` printed and your own domain (the Worker must be on the same zone as the site, so the widget's default `/api` works):

```toml
name = "notis"
main = "cloudflare.mjs"
compatibility_date = "2024-09-01"
kv_namespaces = [{ binding = "COMMENTS", id = "<your KV namespace id>" }]
routes = [{ pattern = "your-site.example/api/comments*", zone_name = "your-site.example" }]
```

Then `wrangler secret put COMMENTS_ADMIN_TOKEN` and `wrangler deploy`. To try it first, `wrangler dev --local` serves the Worker on a local port. The binding must be called `COMMENTS`.

**Vercel**

Create and connect a **private** Blob store in the Vercel project's Storage tab, then:

```bash
mkdir -p api
curl -fsSL https://notis.gavinwye.com/v<version>/server/vercel.mjs -o api/comments.js
npm install @vercel/blob
```

Add a rewrite so nested routes such as replies reach the same function:

```json
{
  "rewrites": [{ "source": "/api/comments/:path*", "destination": "/api/comments" }]
}
```

Vercel supplies `BLOB_READ_WRITE_TOKEN` when the store is connected. The store must be private because notes can contain review material.

**Node**

```bash
curl -fsSL https://notis.gavinwye.com/v<version>/server/node.mjs -o notis-server.mjs
COMMENTS_ADMIN_TOKEN=... COMMENTS_DIR=/data node notis-server.mjs
```

Needs Node 18 or later and a folder that persists. It listens on port `8787` (set `PORT` to change it) on **all** network interfaces and speaks plain HTTP, so put it behind a reverse proxy that does TLS (Caddy, nginx, your host's router) or firewall it so only the proxy can reach it; don't expose it directly.

If it's on a different address from the site, set `apiBase` to the full address (for example `https://notis.example.com/api`) and `COMMENTS_ALLOWED_ORIGINS` to the site's origin. The allowed origins are matched exactly, scheme, host and port: `http://localhost:3000` and `http://127.0.0.1:3000` are different origins.

**Settings** (as environment variables, or secrets on the host, never in the repo):

| Variable | Default | What it does |
|---|---|---|
| `COMMENTS_ADMIN_TOKEN` | unset | A long random string, for example `openssl rand -hex 32`. Needed to delete a note and to list the notes of all pages. If unset, those requests are refused. |
| `COMMENTS_ALLOWED_ORIGINS` | unset (any) | The site's origins, comma separated, exact match. It is a browser CORS policy, not authentication: scripts that send no `Origin` are not blocked. |
| `COMMENTS_MAX_THREADS_PER_PAGE` | `500` | Refuse new notes after a page reaches this many. |
| `COMMENTS_MAX_REPLIES_PER_THREAD` | `1000` | Refuse new replies after a note reaches this many. |
| `COMMENTS_DUPLICATE_WINDOW_MS` | `60000` | Reject a repeat of the same note or reply (same author, same words or image spot, same text) within this many milliseconds. `0` turns the check off. |
| `COMMENTS_DASHBOARD` | unset | Optional. `public` lets anyone read the notes dashboard at `/api/comments/dashboard` (page list and counts). Unset, the dashboard asks for the admin token. Only set it if the notes are not private. |
| `COMMENTS_STORE` | `comments` | Netlify only. A different store name for each site. |
| `COMMENTS_DIR` | `./comments-data` | Node only. The folder the notes are kept in. |
| `PORT` | `8787` | Node only. |

Never print, log or commit the token. If you can't set it yourself, tell the user the variable names and stop.

Preview deploys need the function too, so check it's included in the build, not only production.

## Where the notes end up

They are kept on the user's own host: Netlify Blobs (store `COMMENTS_STORE`, default `comments`), their Cloudflare KV namespace, or the folder `COMMENTS_DIR` for Node. On Netlify, production and deploy previews share the store, so use a different `COMMENTS_STORE` for each site. Tell the user where they are when you report back. Anyone with the admin token can export them with `curl -H "Authorization: Bearer $COMMENTS_ADMIN_TOKEN" <site>/api/comments`.

## 6. Check it works

1. Open the page, select a sentence, click Add note, add a name and a note. (The button and box say Notes and Add note by default; `noun: "comment"` changes the word.)
2. Reload. The highlight and the note should still be there.
3. For shared storage, `curl "<site>/api/comments?page=<pageId>"` returns JSON containing the note. `pageId` is the page's URL path unless you set it: `/` for the home page, `/about` for `/about`. A request without `?page=` lists every page and needs the admin token (`-H "Authorization: Bearer $COMMENTS_ADMIN_TOKEN"`); without it you get `403`.
   If something doesn't work, the user can report it at https://github.com/gavinwye/notis.gavinwye.com/issues/new?template=bug_report.yml. Give them the output of `NotisVersion` in the browser console and which host they chose.
4. With shared storage, open the page in a private window. The note should be there too. (In browser-only mode it won't be: that mode keeps notes in one browser only.)

Report back with what you changed, what you checked, and anything the user must do (for example, setting the token).

Tell the user how to update later: they can ask a coding agent "Update Notis in this site. Follow the instructions at https://notis.gavinwye.com/update.md". Copied files only change when someone updates them, and server updates can be security fixes, so it's worth doing when a new version is released.

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
| `activation` | unset | Optional reviewer gate: `{ query: "notis", hosts: ["*.netlify.app"] }`. A matching host or `?notis=1` enables it and remembers the choice; `?notis=0` disables it. |
| `dashboard` | `false` | Add an "All pages" link in the panel to the notes dashboard at `{apiBase}/comments/dashboard`. |

For a review tool that stays hidden from ordinary visitors, set `activation`. Use the host pattern for deploy previews, the query flag for selected reviewers, or both. Explain that this hides the widget but is not authentication; protect the page and API separately when notes are private.

## Reading the notes

```bash
curl -s "<site>/api/comments?page=<pageId>"
```

Each thread has `quote` (the words), `text` (the note), `resolved`, and `replies`. A pinned thread has `pin` instead of a quote. To mark one done, `PATCH /api/comments/<id>` with `{"resolved": true}`.

Deleting needs the admin token. An empty id is refused with `400` and removes nothing (only `DELETE /api/comments`, with no trailing slash, clears every note), but when you script it, still quote the id (`"$ID"`) so a mistake shows up as an error.
