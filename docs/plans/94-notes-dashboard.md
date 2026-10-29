# Plan: notes dashboard (issue 94)

Issue: [Comment dashboard](https://github.com/gavinwye/notis.gavinwye.com/issues/94)

Mockup: https://claude.ai/artifact/WPjjBBfdHAExJYsMegarF3 (private until shared). The chosen design is "V4 Notis style".

Build steps for Claude Code: [`94-dashboard-build.md`](94-dashboard-build.md).

## The problem

Notes only show on the page they were left on. A reviewer who is not on that page cannot see them. There is no way to see what has been said across a site, or to jump to a note on another page.

The request: a list of pages with note counts, grouped by where they sit in the site (About > National, 2 notes), with a link to go there.

## What the code does today

- Every thread has a `pageId`. By default it is the URL path.
- `GET /api/comments?page=<pageId>` returns one page's threads. Anyone can call it.
- `GET /api/comments` with no `page` returns every thread, but only with the admin token. A token in the widget would not be secret, so the browser cannot use it.
- A thread stores no page title and no URL. For a custom `pageId` such as `homepage`, we cannot tell where the page lives.
- The widget has no way to open a page with a given note focused.

These four facts shape the plan.

## Decisions to make

**1. Who can see the dashboard?**

Recommendation: the site owner chooses, with one setting, `COMMENTS_DASHBOARD`.

- unset: admin token only. Nothing changes for existing sites.
- `public`: anyone who can reach the API can open it.

The issue comes from a reviewer, so `public` has to be possible. Notes are already readable by anyone who knows a `pageId`. Listing the page IDs makes them easier to find, so it must be opt in.

**2. Where does the page live?**

Recommendation: the API serves it, at `GET /api/comments/dashboard`. The HTML is a string in `server/core.mjs`, so it works on every host with no extra file to install. It keeps the "one script and one small function" promise.

Alternatives: a static `notes.html` the owner copies in, or a view inside the widget panel. The first adds an install step. The second suits a few pages but not a site with 40.

**3. Where do titles and URLs come from?**

Recommendation: the widget sends `title` and `url` when it creates a note. The dashboard uses them when present. For older notes it falls back to `pageId` when that is a path, and shows the bare `pageId` otherwise.

Existing notes get no link until someone leaves a new note on that page. That is acceptable for a first release.

## Approach

### Server (`server/core.mjs`)

1. Add `title` and `url` to thread creation. Clip them like the other fields (`title` 200, `url` 500). Accept `url` only if it starts with `/` or `http`.
2. Add `GET {base}?summary=1`. It returns one row per page: `pageId`, `title`, `url`, `open`, `resolved`, `latest`. No note text. Allowed with the admin token, or for anyone when `COMMENTS_DASHBOARD=public`.
3. Add `GET {base}/dashboard`. It returns the HTML page. The page holds no data, so it is always served. The summary and note calls it makes are what the setting gates. With no public setting, the page asks for the admin token.
4. Notes on a page load through the existing `?page=` call, only when a row is expanded.
5. Add `COMMENTS_DASHBOARD` to the Netlify, Cloudflare, Vercel and Node adapters.

Cost: the summary reads every thread. On Netlify that is one blob read per thread. Fine for hundreds of notes. If it becomes slow, cache the summary for 30 seconds in the handler. Do not build an index until someone needs one.

### Dashboard page

Matches the mockup. Plain HTML and a small script, no dependencies, Notis colours and Barlow fallback stack.

- Totals: open notes, pages with notes, resolved.
- Filter: Open (default), All, Resolved. Search by note text, name or page.
- Groups by the first path segment. `/about/national` becomes About > National. A `pageId` with no slash sits under "Other".
- Each page row shows its name, path, open and resolved counts, and an Open page link.
- Expanding a row lists its notes: what the note is on, the text, who, when, reply count.
- Export as Markdown, reusing the widget's format.
- Works at 390 px wide. Rows stack. Buttons are at least 44 px high.
- Uses `--notis-*` properties where the owner has set them.

### Widget (`public/comments.js`)

1. Send `title` (`document.title`) and `url` (`location.pathname + location.search`) with each new note.
2. Read `#notis-<threadId>` on load. Open the panel and call the existing `goTo`. This is what "Go to note" links use.
3. Add an "All pages" link in the panel footer when the dashboard is on. The widget finds out from a new `dashboard: true` flag in `GET ?page=` responses, or a `dashboard` option. Decide at build time; the option is simpler.

### Docs and release

- README: new section and two rows in the server settings table.
- `site/install.md` and `site/update.md`: mention the setting.
- CHANGELOG: Widget yes, Server yes. Bump to 0.5.0.
- Privacy page: say that titles and URLs are now stored.
- Add a screenshot of the dashboard to `docs/images`.

## Tests

Add to `test/core.test.mjs`:

- Summary is refused without a token, allowed with one, allowed for anyone when public.
- Summary counts open and resolved correctly across pages and returns no note text.
- `title` and `url` are clipped and a `javascript:` URL is dropped.
- The dashboard route is served without a token, and sends a content security policy.

Add one build test that the dashboard HTML is present in each built server file. Run the adapter tests for all four hosts.

## Delivery in three steps

1. Server: fields, summary, setting, tests. Ships without a visible change.
2. Dashboard page and widget changes.
3. Docs, screenshot, release.

Each step can merge on its own.

## Not in this plan

- Replying or resolving from the dashboard. Add it once people use the list.
- Filtering by author.
- Emailing or notifying anyone.
- A dashboard that spans more than one site.

## Risks

- **Listing makes pages findable.** Mitigated by opt in. State it in the README.
- **Old notes have no link.** Shown as the `pageId` with no Open page link.
- **Slow summary on large stores.** Measure with 1,000 threads before release. Add the 30 second cache if needed.
- **Size of `comments.js`.** The page lives in the server, so the widget grows by a few lines only.
