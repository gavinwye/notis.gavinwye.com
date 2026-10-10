# Add Notis to a site

Notis lets reviewers select text on a page, or drop a pin on an image, and leave a comment. Everyone who opens the page sees the same comments. Home: https://notis.gavinwye.com. Source: https://github.com/gavinwye/notis.gavinwye.com (MIT).

You are an AI agent adding Notis to the user's site. Follow these steps in order. Ask the user before step 5 and before anything that deploys to production.

## 1. Decide where it should run

Ask, or work out from the repo:

- **Reviewers only (recommended).** Load it on preview builds or behind a password. This is what Notis is for.
- **Everywhere.** Only if the user says so. Anyone who can load the page can comment, with no sign-in.

If the site has a preview or staging build, wire it there. If there's only production, say so and ask.

## 2. Get the script

Save a copy in the folder the site serves static files from (`public/`, `static/`, the site root, or similar) so it's served at `/comments.js`:

```bash
curl -fsSL https://notis.gavinwye.com/comments.js -o <static dir>/comments.js
```

Commit the file. Don't load it from a CDN.

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

## 4. Choose where comments are stored

| Option | Use when | Setup |
|---|---|---|
| **Browser only** | A quick demo. Comments aren't shared. | Add `<script>window.COMMENTS_CONFIG = { apiBase: null };</script>` before the script tag. Nothing else. |
| **Shared, on Netlify** | Real review. | Steps 5 and 6. |
| **Shared, elsewhere** | Not on Netlify. | Implement the API in the README (6 endpoints) and set `apiBase`. Tell the user it's more work. |

## 5. Shared storage on Netlify

Ask the user first. This adds a serverless function and an environment variable.

```bash
mkdir -p netlify/functions
curl -fsSL https://notis.gavinwye.com/server/comments.mjs -o netlify/functions/comments.mjs
npm install @netlify/blobs
```

Then set these in Netlify (site settings, environment variables), not in the repo:

| Variable | Value |
|---|---|
| `COMMENTS_ADMIN_TOKEN` | a long random string, for example `openssl rand -hex 32`. Guards deleting comments. |
| `COMMENTS_ALLOWED_ORIGINS` | the site's origins, comma separated. |
| `COMMENTS_STORE` | optional. A different store name for each site. |

Never print, log or commit the token. If you can't set it yourself, tell the user the variable names and stop.

Preview deploys need the function too, so check it's included in the build, not only production.

## 6. Check it works

1. Open the page, select a sentence, click Comment, add a name and a comment.
2. Reload. The highlight and the comment should still be there.
3. For shared storage, `curl <site>/api/comments` returns JSON containing the comment.
4. Open the page in a private window. The comment should be there too.

Report back with what you changed, what you checked, and anything the user must do (for example, setting the token).

## Options

Set before the script, or as `data-*` attributes on the tag:

| Option | Default | What it does |
|---|---|---|
| `apiBase` | `"/api"` | Where the API lives. `null` keeps comments in the browser only. |
| `pageId` | the URL path | Pages with the same value share comments. |
| `root` | `"body"` | CSS selector for the region people can comment on. |
| `dock` | `false` | Push the page over to make room for the panel. |
| `pins` | `true` | Allow pins on images. |

## Reading the comments

```bash
curl -s "<site>/api/comments?page=<pageId>"
```

Each thread has `quote` (the words), `text` (the comment), `resolved`, and `replies`. A pinned thread has `pin` instead of a quote. To mark one done, `PATCH /api/comments/<id>` with `{"resolved": true}`.
