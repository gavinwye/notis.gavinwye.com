# Notis

[![CI](https://github.com/gavinwye/notis.gavinwye.com/actions/workflows/ci.yml/badge.svg)](https://github.com/gavinwye/notis.gavinwye.com/actions/workflows/ci.yml)

Think comments in Google Docs, for any web page. Notis is Swedish for a short note: select text on a page and leave a note on it. A side panel lists every note, with replies and resolve, and everyone who opens the page sees the same list.

It's one script on the page and one small serverless function behind it. No accounts, no database to set up, no build step.

**Site:** https://notis.gavinwye.com

## Why it exists

Reviewing a prototype by email means vague notes: "the second paragraph feels off". Here the reviewer selects the words they mean and says what's wrong with them. The note stays attached to those words, and you can see all of them in one place.

It was built to get fast reactions to early prototypes.

## What you get

- **Notes on the exact words.** Select text, leave a note. The highlight stays on that text if the page changes slightly.
- **Pins on images.** Choose Pin on image in the panel and click the spot you mean. The pin stays at that point when the image is resized.
- **Threads.** Replies, resolve and reopen, and a toggle to show resolved ones.
- **Shared.** Everyone who opens the page sees the same notes.
- **A JSON API.** A script (or an AI assistant) can read the open notes and work through them. See [Closing the loop](#closing-the-loop).
- **One file in, one file out.** `comments.js` has no dependencies and injects its own styles.

## What it looks like

![A note box open on a paragraph, with a name and a note typed in](docs/images/comment-box.png)

The note box asks for a name once, then the note.

![The side panel listing three notes, one of them a pin on an image](docs/images/panel.png)

Every note is in one list, in the order it appears on the page.

![A round numbered pin on the Continue button of a wireframe](docs/images/pin.png)

A pin marks a point on an image. It stays there when the image is resized.

## Try it

```bash
git clone https://github.com/gavinwye/notis.gavinwye.com
cd notis.gavinwye.com
npm install
npx netlify dev        # http://localhost:8888
```

Open the page, select some text, and leave a note. You need the [Netlify CLI](https://docs.netlify.com/cli/get-started/) and `netlify login`.

## Ask an agent to add it

Paste this into a coding agent (Claude Code, Codex, Cursor) working in your site's folder:

```
Add Notis to this site. Follow the instructions at https://notis.gavinwye.com/install.md
```

[`site/install.md`](site/install.md) is written for the agent. It asks where Notis should run, copies the script, adds one line to your layout, sets up storage if you want it shared, and checks it works. It asks before it adds a function or touches production. There's also an [`llms.txt`](https://notis.gavinwye.com/llms.txt).

## Add it to a page

Before `</body>`:

```html
<script src="/comments.js" defer></script>
```

Out of the box it keeps one thread list per URL path and stores them through `/api/comments`.

### Pin a version

The script at `https://notis.gavinwye.com/comments.js` changes when a new version is released. For anything you don't want to change under you, use the versioned address, which never changes, and add its integrity hash so the browser refuses a file that doesn't match:

```html
<script src="https://notis.gavinwye.com/v0.2.0/comments.js"
        integrity="sha384-..." crossorigin="anonymous" defer></script>
```

The ready-made tag, with the real hash, is at `https://notis.gavinwye.com/v0.2.0/snippet.html`. `https://notis.gavinwye.com/version.json` lists the current version, its hash and the server files. You can also keep your own copy: `curl -O https://notis.gavinwye.com/v0.2.0/comments.js`.

It's also prepared for npm as `@gavinwye/notis`: the widget is `@gavinwye/notis/comments.js`, and the servers are under `@gavinwye/notis/server/…`. (Not published yet.)

### Options

Set them with a global before the script, or with `data-*` attributes on the tag.

```html
<script>window.COMMENTS_CONFIG = { pageId: "homepage", root: "main", dock: true };</script>
<script src="/comments.js" defer></script>

<!-- or -->
<script src="/comments.js" data-page-id="homepage" data-root="main" data-dock="true" defer></script>
```

| Option | Default | What it does |
|---|---|---|
| `apiBase` | `"/api"` | Where the API lives. Set `null` to keep notes in this browser only (not shared). |
| `pageId` | the URL path | The thread list for this page. Pages with the same `pageId` share threads. |
| `root` | `"body"` | CSS selector for the region people can leave notes on. |
| `pins` | `true` | Let reviewers drop a pin on an image. Set `false` to turn it off. |
| `noun` | `"note"` | What things left on the page are called on screen: Notes, Add a note, and so on. Set `"comment"` to get Comments and Add a comment. |
| `dock` | `false` | Push the page over to make room for the panel, rather than covering it. |
| `supabase` | `null` | `{ url, anonKey }` to use Supabase instead of the Netlify function. |

### Events

The widget fires events on `document`, so a page can react to a note, for example by highlighting the column the text sits in.

| Event | `detail` | When |
|---|---|---|
| `comments:select` | `{ el }` | text was selected inside the root |
| `comments:focus` | `{ el }` | a thread's highlight was focused |
| `comments:close` | | the panel was closed |
| `comments:created` | `{ thread }` | a comment was posted |
| `comments:replied` | `{ id }` | a reply was posted |
| `comments:resolved` | `{ id, resolved }` | a thread was resolved or reopened |

## Run your own server

The API is one small piece of code that talks to a storage object, with a short adapter for each host. Pick the one you already use:

| Host | File | Kept in | Notes |
|---|---|---|---|
| **Netlify** | [`server/netlify.mjs`](server/netlify.mjs) | Netlify Blobs, in your account | Drop it in `netlify/functions/comments.mjs`, `npm i @netlify/blobs` |
| **Cloudflare Workers** | [`server/cloudflare.mjs`](server/cloudflare.mjs) | a Workers KV namespace bound as `COMMENTS` | Route `your-site/api/comments*` to the Worker |
| **Any Node 18+ server** | [`server/node.mjs`](server/node.mjs) | JSON files in a folder (`COMMENTS_DIR`) | `node server.mjs`. Works in Docker, on a VPS, on Fly or Railway |
| **Browser only** | none | each reviewer's own browser | `apiBase: null`. Not shared |

Each file is also available on its own at `https://notis.gavinwye.com/server/<host>.mjs`, with the core code built in, so you can download one file and use it. In the repo they share `server/core.mjs`, and `npm run build:server` writes the single files.

Cloudflare, with a Worker named `notis`:

```toml
# wrangler.toml
name = "notis"
main = "cloudflare.mjs"
compatibility_date = "2024-09-01"
kv_namespaces = [{ binding = "COMMENTS", id = "<your KV namespace id>" }]
routes = [{ pattern = "your-site.example/api/comments*", zone_name = "your-site.example" }]
```

Run `wrangler secret put COMMENTS_ADMIN_TOKEN`, then `wrangler deploy`.

Node, in a container:

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY node.mjs .
ENV COMMENTS_DIR=/data PORT=8787
VOLUME /data
CMD ["node", "node.mjs"]
```

If it's on a different address from your site, give the widget the full URL (`apiBase: "https://notis.example.com/api"`) and set `COMMENTS_ALLOWED_ORIGINS` to your site.

### Server settings

| Variable | Default | What it does |
|---|---|---|
| `COMMENTS_ADMIN_TOKEN` | unset | Needed to delete. If unset, all deletes are refused. |
| `COMMENTS_ALLOWED_ORIGINS` | unset (any) | Comma-separated origins allowed to call the API from a browser. Set this to your site. |
| `COMMENTS_STORE` | `comments` | Netlify only: the blob store name. Use a different one for each site. |
| `COMMENTS_DIR` | `./comments-data` | Node only: where the files go. |
| `PORT` | `8787` | Node only. |

Each thread is stored on its own, so two reviewers adding notes at the same moment don't overwrite each other.

## Where your notes live

On your own host, in your own account. On Netlify that's a [Netlify Blobs](https://docs.netlify.com/blobs/overview/) store (named `comments`, or whatever `COMMENTS_STORE` says), one blob per thread under `t/<id>`. On Cloudflare it's your KV namespace, and on Node it's a folder of JSON files. Nobody else holds a copy: there is no central Notis service, and the Notis site never sees your comments.

- **One store for the whole site.** Production and deploy previews share it. A comment left on a preview also shows on any page with the same `pageId` in production. Use a different `COMMENTS_STORE` per site, and give previews their own `pageId` if you don't want that.
- **Export or back up:** `curl -H "Authorization: Bearer $COMMENTS_ADMIN_TOKEN" https://your-site/api/comments > comments-backup.json` works on any host. On Netlify you can also use `netlify blobs:list comments`.
- **Read them while running locally:** `netlify dev` uses a local sandbox, so notes left there don't reach your live site.
- **The demo is different.** With `apiBase: null` (as on the Notis site), notes stay in each visitor's browser and are never sent anywhere.

### Analytics

Notis sends nothing anywhere except to your own API, and it has no tracking of its own. If you want to count activity, listen for the events and send them to the analytics you already use:

```js
document.addEventListener("comments:created", () => umami.track("comment-created"));
```

## Bugs and ideas

Open an issue on GitHub: [report a bug](https://github.com/gavinwye/notis.gavinwye.com/issues/new?template=bug_report.yml) or [suggest something](https://github.com/gavinwye/notis.gavinwye.com/issues/new?template=feature_request.yml). The bug form asks which host you use and for the version, which you can read by typing `NotisVersion` in the browser console. Security problems should go through [SECURITY.md](SECURITY.md) instead.

## The API

| Request | Body | Returns |
|---|---|---|
| `GET /api/comments?page=<pageId>` | | `[thread, ...]` (all pages if `page` is left off) |
| `POST /api/comments` | `{ pageId, quote, prefix, suffix, author, text, pin? }` | the new thread |
| `POST /api/comments/:id/replies` | `{ author, text }` | the new reply |
| `PATCH /api/comments/:id` | `{ resolved }` | the updated thread |
| `DELETE /api/comments/:id` | | removes one thread (admin token) |
| `DELETE /api/comments` | | removes everything (admin token) |

A pin is `{ src, alt, i, x, y }`: the image's `src`, its `alt` text, its position among the page's images, and the point as fractions (0 to 1) of the image's width and height. A pinned thread has an empty `quote`.

The server sets `id`, `createdAt`, `resolved` and `replies`. Whatever the client sends for those is ignored. Every field is length-capped and bad input gets a `400`.

```json
{
  "id": "mgx1k2ab9z",
  "pageId": "/some/page",
  "quote": "the words that were selected",
  "prefix": "up to 32 characters before",
  "suffix": "up to 32 characters after",
  "author": "Sam",
  "text": "This says 'apply', but the next page says 'register'.",
  "createdAt": 1700000000000,
  "resolved": false,
  "replies": [{ "id": "…", "author": "Alex", "text": "Agreed, fixing.", "createdAt": 1700000100000 }]
}
```

Deleting sends the token in a header, never in the URL:

```bash
curl -X DELETE -H "Authorization: Bearer $COMMENTS_ADMIN_TOKEN" \
  https://your-site.netlify.app/api/comments/THREAD_ID
```

## Closing the loop

Notes are plain JSON, so the person (or assistant) fixing the page can read them directly:

```bash
curl -s "https://your-site.netlify.app/api/comments?page=/some/page" \
  | jq '.[] | select(.resolved|not) | {quote, text}'
```

Each open note gives you the words it points at and what was said about them. Fix the page, then `PATCH` the thread with `{"resolved": true}`. We use this with Claude: it reads the open notes, makes the edits, and marks them resolved.

## Keyboard and screen readers

Everything works without a mouse.

| Do this | With the keyboard |
|---|---|
| Add a note on text | Select it (Shift + arrow keys), then press **Alt+Shift+C**. Or open the panel and choose **Add note on selection** |
| Open or close the panel | Tab to **Notes** and press Enter. **Esc** closes it |
| Pin an image | Panel, **Pin on image**, Tab to an image, arrow keys move the pin (Shift for small steps), **Enter** drops it |
| Find a note's words | **Go to text** in the panel moves focus to the highlight |
| Back out | **Esc** closes the innermost thing first: the reply box or note box, then pin mode, then the panel |

What it does for assistive technology:

- The panel is a labelled region, and a modal dialog on phones. The closed panel can't be reached with Tab.
- Notes are a list. Each is named by the words it's about, and each button says which note it acts on.
- A live region announces "Note added", "Reply added", "Thread resolved", how many notes are unresolved when the panel opens, and errors, with a Retry button.
- Focus moves into the note box when it opens and goes back to where it was when it closes.
- Contrast meets WCAG 2.2 AA, focus is always a heavy ring, controls are at least 24 px (44 px on touch), motion stops with `prefers-reduced-motion`, and highlights and buttons keep a border in forced-colours mode.

`node scripts/check-a11y.mjs` checks these in a browser (it can also run axe-core). It can't replace testing with a screen reader, and VoiceOver, NVDA and TalkBack haven't been run against it yet. If something is in the way, [report it](https://github.com/gavinwye/notis.gavinwye.com/issues/new?template=bug_report.yml).

## How notes stay attached

Each note stores the selected text plus up to 32 characters either side (the W3C text-quote approach). When the page loads, the widget finds that text again and highlights it. If the words have been edited, the note stays in the panel with a notice that the text has changed.

## What it doesn't do

Worth knowing before you rely on it.

- **No sign-in.** Anyone who can load the page can leave a note, under whatever name they type. Put the page behind a password or a Netlify preview, as you would for any review copy.
- **No notifications.** Nobody is emailed. You look at the panel, or read the API.
- **Not for high traffic.** It's built for a handful of reviewers, not for a public comment section.
- **Text that moves a lot loses its anchor.** The note survives; the highlight doesn't.
- **Pins are for `<img>` elements.** Not CSS backgrounds or inline SVG. A pin finds its image by `src`, so if the image changes, the pin is shown as lost.
- **Pins need the Netlify function or localStorage.** The Supabase adapter would need a `pin` column.

## Layout

```
public/comments.js            the widget
server/core.mjs               the API, with no host in it
server/{netlify,cloudflare,node}.mjs   one adapter per host
scripts/build.mjs             builds the site's generated files (single-file servers,
                              versioned /v<version>/ copies, hashes) and the npm dist/
releases/                     archived releases, republished unchanged (see RELEASING.md)
CHANGELOG.md, RELEASING.md    what changed, and how to release
test/                         `npm test`
site/                         the website (notis.gavinwye.com)
docs/PLAN.md                  how we're publishing it
```

## Licence

MIT. See [LICENSE](LICENSE).
