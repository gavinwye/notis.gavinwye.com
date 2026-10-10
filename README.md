# Comments

Select text on any page and leave a comment on it. A side panel lists every thread, with replies and resolve. Comments are shared with everyone who opens the page.

It's one script on the page and one small serverless function behind it. No accounts, no database to set up, no build step.

**Site:** https://comments.gavinwye.com

## Why it exists

Reviewing a prototype by email means vague notes: "the second paragraph feels off". Here the reviewer selects the words they mean and says what's wrong with them. The comment stays attached to those words, and you can see all of them in one place.

It was built to get fast reactions to early prototypes.

## What you get

- **Comments on the exact words.** Select text, write a comment. The highlight stays on that text if the page changes slightly.
- **Threads.** Replies, resolve and reopen, and a toggle to show resolved ones.
- **Shared.** Everyone who opens the page sees the same comments.
- **A JSON API.** A script (or an AI assistant) can read the open comments and work through them. See [Closing the loop](#closing-the-loop).
- **One file in, one file out.** `comments.js` has no dependencies and injects its own styles.

## Try it

```bash
git clone https://github.com/gavinwye/comments.gavinwye.com
cd comments.gavinwye.com
npm install
npx netlify dev        # http://localhost:8888
```

Open the page, select some text, and comment. You need the [Netlify CLI](https://docs.netlify.com/cli/get-started/) and `netlify login`.

## Add it to a page

Before `</body>`:

```html
<script src="/comments.js" defer></script>
```

Out of the box it keeps one thread list per URL path and stores them through `/api/comments`.

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
| `apiBase` | `"/api"` | Where the API lives. Set `null` to keep comments in this browser only (not shared). |
| `pageId` | the URL path | The thread list for this page. Pages with the same `pageId` share threads. |
| `root` | `"body"` | CSS selector for the region people can comment on. |
| `dock` | `false` | Push the page over to make room for the panel, rather than covering it. |
| `supabase` | `null` | `{ url, anonKey }` to use Supabase instead of the Netlify function. |

### Events

The widget fires events on `document`, so a page can react to a comment, for example by highlighting the column the text sits in.

| Event | `detail` | When |
|---|---|---|
| `comments:select` | `{ el }` | text was selected inside the root |
| `comments:focus` | `{ el }` | a thread's highlight was focused |
| `comments:close` | | the panel was closed |

## Run your own server

1. Push this repo to GitHub and import it into Netlify, or run `npm run deploy`.
2. Netlify reads `netlify.toml`, publishes `public/` and bundles the function.
3. Set `COMMENTS_ADMIN_TOKEN` in the site's environment variables (a long random string).

The only dependency is `@netlify/blobs`.

### Server settings

| Variable | Default | What it does |
|---|---|---|
| `COMMENTS_STORE` | `comments` | Blob store name. Use a different one for each site. |
| `COMMENTS_ADMIN_TOKEN` | unset | Needed to delete. If unset, all deletes are refused. |
| `COMMENTS_ALLOWED_ORIGINS` | unset (any) | Comma-separated origins allowed to call the API from a browser. Set this to your site. |

## The API

| Request | Body | Returns |
|---|---|---|
| `GET /api/comments?page=<pageId>` | | `[thread, ...]` (all pages if `page` is left off) |
| `POST /api/comments` | `{ pageId, quote, prefix, suffix, author, text }` | the new thread |
| `POST /api/comments/:id/replies` | `{ author, text }` | the new reply |
| `PATCH /api/comments/:id` | `{ resolved }` | the updated thread |
| `DELETE /api/comments/:id` | | removes one thread (admin token) |
| `DELETE /api/comments` | | removes everything (admin token) |

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

Comments are plain JSON, so the person (or assistant) fixing the page can read them directly:

```bash
curl -s "https://your-site.netlify.app/api/comments?page=/some/page" \
  | jq '.[] | select(.resolved|not) | {quote, text}'
```

Each open comment gives you the words it points at and what was said about them. Fix the page, then `PATCH` the thread with `{"resolved": true}`. We use this with Claude: it reads the open comments, makes the edits, and marks them resolved.

## How comments stay attached

Each comment stores the selected text plus up to 32 characters either side (the W3C text-quote approach). When the page loads, the widget finds that text again and highlights it. If the words have been edited, the comment stays in the panel with a note that the text has changed.

## What it doesn't do

Worth knowing before you rely on it.

- **No sign-in.** Anyone who can load the page can comment, under whatever name they type. Put the page behind a password or a Netlify preview, as you would for any review copy.
- **No notifications.** Nobody is emailed. You look at the panel, or read the API.
- **Not for high traffic.** All threads live in one blob, so two writes at the same instant can overwrite each other. That's fine for a handful of reviewers, not for a public comment section.
- **Text that moves a lot loses its anchor.** The comment survives; the highlight doesn't.

## Layout

```
public/comments.js            the widget
netlify/functions/comments.mjs  the API
site/                         the website (comments.gavinwye.com)
docs/PLAN.md                  how we're publishing it
```

## Licence

MIT. See [LICENSE](LICENSE).
