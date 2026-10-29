# Build plan: notes dashboard (issue 94)

For Claude Code. Read [`94-notes-dashboard.md`](94-notes-dashboard.md) first for the why. This file is the how.

Design: the "V4 Notis style" board at https://claude.ai/artifact/WPjjBBfdHAExJYsMegarF3 (private). A copy of its source is in [`94-dashboard-v4.dc.html`](94-dashboard-v4.dc.html). It is a design tool file, not a page you can serve. Read it for exact sizes, colours and sample structure, then write plain HTML.

Branch from `main`. Do not bump the version; follow `RELEASING.md` at release time.

## Decisions already made

- The API serves the dashboard at `GET {base}/dashboard`. No new file for site owners to install.
- The HTML is the same on every host, and contains no data. It is always served. The data calls are what is gated.
- `COMMENTS_DASHBOARD=public` lets anyone read the page summary. Unset, it needs the admin token, and the page asks for it.
- No third party requests. No Google Fonts. Font stack is `var(--notis-font, "Barlow", "Barlow Fallback", system-ui, sans-serif)`.
- Page text is set with `textContent` only. Never `innerHTML` with note data.

## Step 1: server

Files: `server/core.mjs`, `server/dashboard.mjs` (new), `scripts/lib.mjs`, the four adapters.

1. **Thread fields.** In the create handler add `title` (clip 200) and `url` (clip 500) to `LIMITS` and to the thread. Keep `url` only if it starts with `/` or `https://` or `http://`. Otherwise store `""`. Add both to the duplicate check? No, leave it as is.
2. **Summary.** `GET {base}?summary=1` returns one row per `pageId`:
   `{ pageId, title, url, open, resolved, latest }`. `latest` is the newest `createdAt` or reply time. `title` and `url` come from the newest thread that has them. No note text.
   - Allowed with the admin token.
   - Allowed for anyone when `config.dashboard === "public"`.
   - Otherwise `403` with `{ error: "admin token required" }`.
   Put this before the existing "no page" check so `?summary=1` is not treated as a full export.
3. **Dashboard route.** In `handle`, before the `ID.test(seg[0])` check, return the page for `GET` when `seg.length === 1 && seg[0] === "dashboard"`. The word `dashboard` matches the id pattern, so it must be caught first. Thread ids come from `newId()` and cannot be `dashboard`.
   Response headers:
   - `Content-Type: text/html; charset=utf-8`
   - `Cache-Control: no-store`
   - `Content-Security-Policy: default-src 'none'; style-src 'nonce-X'; script-src 'nonce-X'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'`
   - `X-Content-Type-Options: nosniff`
   Make a fresh nonce per response with `crypto.getRandomValues` and put it on the `<style>` and `<script>` tags. The CORS headers from `corsHeaders` use `application/json`, so build this response separately.
4. **Setting.** Add `config.dashboard` in `createHandler`. Pass `COMMENTS_DASHBOARD` in `netlify.mjs`, `cloudflare.mjs`, `vercel.mjs` and `node.mjs` (also `createNodeServer`).
5. **Routes.** Netlify's `config.path` lists exact paths. Add `"/api/comments/dashboard"`. Check how `/api/comments/:id` and the new path interact on Netlify, and say what you found. Cloudflare and Vercel already route `/api/comments*`.
6. **Where the HTML lives.** Create `server/dashboard.mjs` exporting `dashboardHtml(nonce)` that returns the page string. `core.mjs` imports it. The build inlines `core.mjs` by stripping `export `, so teach `serverSources` in `scripts/lib.mjs` to inline `dashboard.mjs` the same way, ahead of the core, and remove the `import ... "./dashboard.mjs"` line. Keep the exported names unique so the inlined file has no clashes.
7. `package.json` `files` already includes `server`. Add nothing else.

Tests, in `test/core.test.mjs`:
- Summary: `403` without a token, `200` with it, `200` for anyone when `dashboard: "public"`.
- Summary counts open and resolved across several pages, uses the newest title and url, and contains no `text` or `quote` fields.
- `?summary=1` does not return a full export without a token.
- Create: `title` and `url` are clipped. `url: "javascript:alert(1)"` is stored as `""`.
- `GET /api/comments/dashboard` returns `200`, `text/html`, a CSP with a nonce that appears in the body, and different nonces on two calls.
- `GET /api/comments/dashboard` works without a token. `DELETE /api/comments/dashboard` is still refused.
- A thread id route still works after the change (`PATCH /api/comments/<id>`).

Tests, in `test/build.test.mjs`: every built server file contains `dashboardHtml` and no `from "./dashboard.mjs"`. Run `npm test`.

Merge this step on its own. It changes no visible behaviour.

## Step 2: the dashboard page

File: `server/dashboard.mjs`. One HTML string, one `<style>`, one `<script>`. Plain JavaScript, no libraries, same ES level as `public/comments.js`.

### Tokens

Copy these from `site/index.html`. Same values, same dark mode.

```css
:root{--ink:#0b0c0c;--muted:#4b5559;--line:#d8dde0;--paper:#fff;--tint:#f6f7f8;--mark:#fff3c4;--markline:#ffc726;--link:#1d5fa3}
@media (prefers-color-scheme:dark){:root{--ink:#f1f3f4;--muted:#aab3b7;--line:#2f373b;--paper:#111517;--tint:#181d20;--mark:#4a3d0c;--link:#7db4ec}}
```

Let the page respect `--notis-font`, `--notis-accent` and `--notis-ink` if set. They will not be set on this page unless the owner edits the HTML, so do not spend time on it.

### Layout, top to bottom

Body is Barlow 19px, line height 1.55, square corners everywhere.

1. **Header.** White, 16px padding, 1px bottom line. Yellow 24px square, then "Notis" in Barlow Semi Condensed 700 at 24px. Links on the right: "All notes" and "Settings" are placeholders in the mockup. **Leave both out.** Keep only the logo and the site host name, small and muted.
2. **Heading.** `h1` 700, `clamp(36px, 6vw, 56px)`: "Every note, <mark>on every page</mark>." The mark has `--mark` background and a 3px `--markline` bottom border, as on the site. One line of lede below at 22px muted: "See where people have left notes on your site and go straight to them."
3. **Totals.** Three boxes on a grid, `repeat(auto-fit, minmax(200px, 1fr))`, 20px gap. Each has `--tint` background, 1px `--line` border, 16px by 18px padding, a 34px bold number and a 17px muted label: Open notes, Pages with notes, Resolved.
4. **Controls.** One row that wraps, 12px by 24px gap.
   - Open, All and Resolved: text buttons, 18px, weight 600. The active one has a 2px `--markline` underline with a 6px offset. The others are muted. Default is Open.
   - Search: `type=search`, 44px high, 1px `--line` border, no radius. Placeholder "Search notes, names or pages".
   - "Export as Markdown": the one filled button. Background `--markline`, colour `#0b0c0c`, 2px `#0b0c0c` border, 8px by 14px padding, weight 600, 44px high.
5. **Sections.** One per first path segment. Top border 1px `--line`, 28px top padding. `h2` 30px Barlow Semi Condensed 700, then the note count in muted 17px, for example "4 notes".
6. **Page rows.** Border bottom 1px `--line`. A flex row that wraps:
   - A 30px square. Black (`--ink`) with `--paper` text when the page has open notes in the current filter, outlined and muted when not. It shows the open count.
   - A button with the page name (19px, 600) and below it the path, a dot, then "2 open, 1 resolved" in 16px muted. The whole button toggles the notes.
   - "Open page" link, 17px 600, with the site's yellow underline.
   - "Show notes" / "Hide notes" text button with the same underline.
7. **Notes list**, when a row is open. Inside a 1px `--line` box (no bottom border on the last item, so it does not double up). Each note is a list item with 14px by 16px padding and a 1px bottom line:
   - Target line, 16px muted, 2px `--markline` left border, 10px padding. The quote in curly quotes, or "General", or "Image: <alt or src>".
   - Meta line, 14px muted: `Name · 3 days ago · 1 reply`.
   - Text, 19px.
   - Actions, 15px 600: Go to note, Reply, Resolve (Reopen on resolved notes).
8. **Footer line.** 15px muted, top border. For the admin case: "Notes load from your own server." Do not repeat the sentence about the admin token as a fixed line. Show it only when a token is needed.

### Links, underlines and focus

Links follow the site: ink text, 2px `--markline` underline, 3px offset, `--mark` background on hover. Focus is `outline: 3px solid var(--ink); outline-offset: 2px`. Every target is at least 44px high on touch.

### Behaviour

- On load, call `?summary=1` on the same base path. Work out the base from `location.pathname` minus `/dashboard`.
- `403`: show a short form, "Enter the admin token to see all notes", with a password input and a button. Keep the token in `sessionStorage` only. Send it as `Authorization: Bearer`. Never put it in the URL. Wrong token shows an error line and keeps the form.
- Grouping. Use `url` if there is one, else `pageId` if it starts with `/`. Split on `/`. First segment, title-cased, is the section. No usable path goes under "Other", listed last. Page name is `title` if present, else the last segment title-cased with `-` as spaces, else the `pageId`. Sort sections A to Z, pages by path.
- Expanding a row calls `?page=<pageId>` once and keeps the result. Show "Loading notes" in a live region while it runs. On failure show a message and a Retry button, as the widget does.
- Filter changes counts, hides pages with nothing to show, and hides sections that end up empty. Counts in squares and section headings follow the filter.
- Search matches page name, path, and (once notes are loaded) note text and author. Typing in search loads every page's notes once, six requests at a time, with a "Loading notes from 12 pages" status.
- Resolve and Reopen: `PATCH {base}/<id>` with `{ resolved }`, then update the counts. Disable the button while it runs. Show an inline error with Retry on failure.
- **Reply:** an inline textarea and a name field under the note, `POST {base}/<id>/replies`. Use the same `comments:author` value in `localStorage` as the widget. If this is too much for one change, cut it and remove the link. Say which you did.
- Go to note: `<url>?notis=1#notis-<id>`. Open page: `<url>?notis=1`. Hide both when the page has no `url`. The `notis=1` query turns on a site that uses reviewer activation, and is harmless otherwise.
- Export as Markdown: load every page, build the Markdown in the same shape as `exportMarkdown` in `public/comments.js` with a heading per page, then copy it. Fall back to a download if clipboard is blocked.
- Relative times: reuse the logic of `when()` in `public/comments.js`.
- Render with `createElement` and `textContent`. No template strings of note data into HTML.

### Accessibility and responsive

- Landmarks: `header`, `main`. One `h1`.
- Row buttons have `aria-expanded` and `aria-controls`. Filter buttons use `aria-pressed`.
- A visually hidden live region announces loading, errors, and resolve results.
- `prefers-reduced-motion`: no transitions.
- Works at 390px wide with no sideways scroll. Rows stack, the controls wrap, the totals become one column.
- Contrast: check the muted text on `--tint` in both themes.

Tests: add to `test/core.test.mjs` that the HTML contains no `innerHTML` and no `http://` or `https://` strings other than the ones you intend. Then check the page by hand in a browser against the mockup using `npx netlify dev` or `node server/node.mjs` with a few seeded notes, at 1280px and 390px, light and dark.

## Step 3: widget

File: `public/comments.js`. Keep the diff small.

1. When a note is created (the two places that build `{ id: uid(), pageId: ... }`, around `openSheet` and `openComposer`, and the general note path), add `title: document.title` and `url: location.pathname + location.search`. Do not send the hash.
2. On `init`, if `location.hash` matches `#notis-<id>`, open the panel and call `goTo(id)` once the threads have loaded and highlights are applied. Do nothing if the id is unknown. Do not change the hash.
3. New option `dashboard` (default `false`, also `data-dashboard`). When true, the panel footer shows an "All pages" link to `{apiBase}/comments/dashboard`. Use the existing link style. It is not shown with `apiBase: null`.
4. Document the option in the header comment of the file and in the README options table.

Tests: if there is a widget test harness, add cases for the hash and the new fields. If not, say so in the pull request and cover it in the manual check. Run `node scripts/check-highlights.mjs` and `node scripts/check-a11y.mjs` if the tooling is available.

## Step 4: docs and release prep

- `README.md`: a "Notes dashboard" section with a screenshot, the `COMMENTS_DASHBOARD` row in the server settings table, the `dashboard` row in the widget options table, and a note that public means anyone can list page names and read notes.
- `site/install.md`, `site/update.md`, `site/llms.txt`: mention the setting where the other settings are listed.
- `site/privacy.html` and the README "Where your notes live" section: each note now stores the page title and URL.
- `CHANGELOG.md`, under Unreleased: "Widget: yes. Server: yes." Added entries with the issue link.
- Screenshot: follow `scripts/screenshots.mjs`. Save to `docs/images/dashboard.png`.

## Definition of done

- `npm test` passes. `node --check` passes for the widget, server and scripts, as in CI.
- `npm run build:server` writes four working single files. Each serves the dashboard.
- By hand: admin only and public both work. A public setting does not expose the full export (`GET {base}` with no `page`).
- The page looks like V4 at 1280px and 390px, in light and dark.
- Existing notes without `title` or `url` appear under their path, or under Other, with no Open page link.
- Resolving from the dashboard shows in the widget within 25 seconds.

## Pull requests

Four small pull requests, one per step, in order. Each says which steps remain. Reference issue 94. Do not open one that mixes the server and the widget.

## Questions to put to Gavin before starting step 2

- Keep Reply in the first release, or cut it?
- Leave "All notes" and "Settings" out of the header (assumed yes)?
- Is a CSP nonce acceptable, or would a fixed hash be preferred?
