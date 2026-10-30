# Changelog

All notable changes to Notis. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the version numbers follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.4.0] - 2026-10-30

**In short:** adds a notes dashboard, one page that lists every page with notes, how many are open or resolved, and a link straight to each note. Notes now remember which page they were left on. Also new: notes that appear without reloading, general notes that aren't tied to any words, copying or downloading a page's notes, an optional reviewer-only mode, colour and font settings, and Vercel support. The button and panel now say Notis.

**What to do:** replace both of your Notis files, the script on your pages (`comments.js`) and the server file. Your existing notes keep working. The dashboard is private by default and asks for your admin token; set `COMMENTS_DASHBOARD=public` only if you want anyone to be able to see it. If you used the old Supabase option, it has been removed.

### Changed
- The Notes button and panel title now say Notis (a site that sets its own `noun` keeps its own word).

### Added
- A notes dashboard: one page, served by the API at `/api/comments/dashboard`, that lists every page with notes, with open and resolved counts, filters, search, Go to note, Reply, Resolve and Export as Markdown. It needs the admin token unless `COMMENTS_DASHBOARD=public`. Replace the server file to get it; the widget's new `dashboard` option adds an "All notes" link. ([#94](https://github.com/gavinwye/notis.gavinwye.com/issues/94))
- New notes store the page title and address, so the dashboard can name and link each page. Older notes keep working and show under their path. A note can be opened from a link ending `#notis-<id>`. ([#94](https://github.com/gavinwye/notis.gavinwye.com/issues/94))
- `GET /api/comments?summary=1`: one row per page with counts and no note text, for the dashboard. ([#94](https://github.com/gavinwye/notis.gavinwye.com/issues/94))
- A Vercel adapter backed by a private Vercel Blob store, with a full storage round-trip test. ([#38](https://github.com/gavinwye/notis.gavinwye.com/issues/38))
- Netlify and Cloudflare deploy buttons, plus a short troubleshooting and migration FAQ. ([#45](https://github.com/gavinwye/notis.gavinwye.com/issues/45))
- CSS custom properties for the accent, ink, font, panel and muted panel text, including dark panel themes. ([#46](https://github.com/gavinwye/notis.gavinwye.com/issues/46))
- Optional reviewer activation by remembered query flag or hostname pattern. ([#35](https://github.com/gavinwye/notis.gavinwye.com/issues/35))
- General page notes, created from the panel and shown above anchored notes. ([#31](https://github.com/gavinwye/notis.gavinwye.com/issues/31))
- New notes appear without a reload: the widget checks every 25 seconds while visible and on focus, without replacing a draft reply. ([#33](https://github.com/gavinwye/notis.gavinwye.com/issues/33))
- Copy a page-ordered Markdown review or download its threads as JSON from the panel. ([#42](https://github.com/gavinwye/notis.gavinwye.com/issues/42))

### Removed
- The undocumented and untested Supabase client adapter. Use the tested Netlify, Cloudflare, Node or browser-only storage paths. ([#39](https://github.com/gavinwye/notis.gavinwye.com/issues/39))

## [0.3.2] - 2026-10-12

**In short:** fixes a way to delete every note by mistake. A delete request with the note's id missing is now refused instead of clearing everything.

**What to do:** replace the server file. Don't skip it. The script on your pages (`comments.js`) is unchanged apart from its version number.

### Fixed
- **An empty id on DELETE no longer clears every note.** `DELETE /api/comments/` (a trailing slash with nothing after it, or an empty segment such as `/api/comments//`, which is what a script sends when its `$ID` is unset) used to be treated as "clear everything" when the admin token was valid. It is now refused with `400` ("a note id is required; to clear all notes use DELETE /api/comments") and nothing is touched. `DELETE /api/comments` with no trailing slash is still the only form that clears everything, and `DELETE /api/comments/<id>` still removes one note (one trailing slash after an id is accepted). ([#79](https://github.com/gavinwye/notis.gavinwye.com/issues/79))

## [0.3.1] - 2026-10-11

**In short:** security and reliability fixes for the server. Listing every page's notes now needs your admin token, there are limits on how many notes and replies a page can get, accidental double posts are caught, and two people replying at the same moment no longer lose a reply.

**What to do:** replace the server file. Don't skip it, because it contains security fixes. The script on your pages (`comments.js`) is unchanged apart from its version number.

### Security
- **The full export needs the admin token.** `GET /api/comments` with no `?page=` returns every page's notes, so it now requires `Authorization: Bearer <COMMENTS_ADMIN_TOKEN>` and answers `403` without it. Reading one page with `?page=<pageId>` is unchanged, so the widget keeps working. ([#69](https://github.com/gavinwye/notis.gavinwye.com/pull/69))
- **Write ceilings and a duplicate check.** At most `COMMENTS_MAX_THREADS_PER_PAGE` threads per page (default 500) and `COMMENTS_MAX_REPLIES_PER_THREAD` replies per thread (default 1000), answered with `429`. The same author sending the same text on the same words, or the same image spot, again within `COMMENTS_DUPLICATE_WINDOW_MS` (default 60 seconds, `0` turns it off) gets `409`. CORS is documented as browser policy, not authentication, with a pointer to host-level rate limiting. ([#73](https://github.com/gavinwye/notis.gavinwye.com/pull/73))

### Fixed
- **Two replies at the same moment no longer lose one.** Writes to a thread are queued, so replies, resolve and reopen can't overwrite each other, and the Node adapter gives every file write its own temporary name. ([#70](https://github.com/gavinwye/notis.gavinwye.com/pull/70))
- **A malformed `%` escape in the path is a `400`**, not a server error. ([#69](https://github.com/gavinwye/notis.gavinwye.com/pull/69))
- **The Cloudflare adapter builds its handler once**, not for every request, so the write queue and the ceilings apply there too. (Found while combining these fixes. [#76](https://github.com/gavinwye/notis.gavinwye.com/issues/76))
- The duplicate check compares the words or image spot as well as the text, so the same remark on two different sentences is allowed. (Found while combining these fixes.)

### Notes
- The write queue lives inside one running copy of the server. Where a host runs several copies at once (Netlify functions, Workers) two requests on different copies can still race, and the ceilings are a soft limit.
- The installation snippets now read one page (`?page=`) instead of the whole list. ([#72](https://github.com/gavinwye/notis.gavinwye.com/pull/72))

## [0.3.0] - 2026-10-11

**In short:** makes Notis easier to use with a keyboard or a screen reader: select text and press Alt+Shift+C to leave a note, pin images from the keyboard, and hear announcements when things change. Focus, contrast and touch targets are clearer. What you see on screen now says Notes instead of Comments (a new `noun` option brings Comments back), and the text is set in Barlow.

**What to do:** replace the script on your pages (`comments.js`). The server file is the same as in 0.2.0, so you can leave it.

### Added
- **Keyboard route to commenting:** select text with Shift + arrow keys and press Alt+Shift+C, or use **Comment on selection** in the panel. Screen readers are told the shortcut when text is selected. ([#29](https://github.com/gavinwye/notis.gavinwye.com/issues/29))
- **Keyboard pinning:** in pin mode images become focusable, arrow keys move the pin and Enter drops it. ([#29](https://github.com/gavinwye/notis.gavinwye.com/issues/29))
- **Go to text / Go to pin** in each comment moves focus to the highlight or pin. ([#29](https://github.com/gavinwye/notis.gavinwye.com/issues/29))
- A live region announces added comments and replies, resolve and reopen, the counts when the panel opens, and errors. A failed post, reply, resolve or load now shows a message with a Retry button instead of failing silently. ([#29](https://github.com/gavinwye/notis.gavinwye.com/issues/29))
- A resolved comment is labelled "Resolved" in words. ([#29](https://github.com/gavinwye/notis.gavinwye.com/issues/29))
- `scripts/check-a11y.mjs`, a browser check for keyboard use, announcements, contrast, target size, reduced motion, forced colours and zoom. ([#29](https://github.com/gavinwye/notis.gavinwye.com/issues/29))

### Changed
- **Text fields** are white with a black border, and the focused field gets a thick yellow bar along its bottom edge. (Phones and tablets keep the two-step sheet from 0.2.0.)
- **The Notis site** has a hamburger menu on phones, a sticky header, Barlow type and the pronunciation (noh-tis).
- **Fonts:** the widget no longer forces Figtree. It uses `--notis-font` if the page sets it, then Barlow, then the system font, and it loads no font of its own. Bold labels use weight 600, so a page that serves Barlow 400/500/600 doesn't get a synthesised bold.
- **The Notis site** now sets its type in Barlow and Barlow Semi Condensed, the family gavinwye.com uses, served from its own files with no request to Google Fonts. The share image, screenshots and demo form use the same fonts.
- **Notes, not comments, on screen.** The button, panel, note box, announcements and errors now say Notes, Add a note and so on. A new `noun` option (`data-noun`) sets the word: `noun: "comment"` gives Comments and Add a comment again. File names, the API (`/api/comments`), events (`comments:*`) and settings (`COMMENTS_*`) are unchanged.
- Escape closes the innermost thing first (reply box or comment box, then pin mode, then the panel), and focus returns to where it was. The comment box and the phone sheet keep Tab inside them while open.
- The panel is a labelled region, and a modal dialog on phones with focus kept inside. The closed panel is hidden from Tab and screen readers, and the Comments button reports `aria-expanded`.
- Comments are a list, each named by its words, and Reply, Resolve and Go to buttons say which comment they act on.
- Highlights use a darker underline so they stand out from the page (3:1), focus rings are a solid ink ring on every control, and controls are at least 24 px (44 px on touch). Resolved comments no longer fade to a low contrast.
- With `prefers-reduced-motion` the panel doesn't slide and the flash is a steady outline. In forced-colours mode highlights, pins and buttons keep a border.

## [0.2.0] - 2026-10-11

**In short:** Notis now works on phones and tablets, adds pins on images and a name field, and comes with ready-made servers for Netlify, Cloudflare and plain Node. Each note is stored on its own, so two people writing at once no longer overwrite each other. The project is renamed Notis.

**What to do:** replace both of your files, the script on your pages (`comments.js`) and the server file. The Netlify server moves older notes across the first time it reads them, and nothing is deleted.

### Added
- Phones and tablets: selecting text with a long-press now works. A "Comment on selection" bar sits at the bottom of the screen, and the comment box is a compact two-step sheet (name, then comment) that keeps your selected words highlighted above the keyboard. ([#47](https://github.com/gavinwye/notis.gavinwye.com/pull/47))
- A close icon in the panel header and a Close button along the bottom; Escape closes the panel. ([#47](https://github.com/gavinwye/notis.gavinwye.com/pull/47))
- Pins: choose **Pin on image** in the panel and click a point on an image. The pin stays at that point when the image is resized. ([#10](https://github.com/gavinwye/notis.gavinwye.com/pull/10))
- A name field in the comment box, asked for first, in place of the browser's pop-up. ([#10](https://github.com/gavinwye/notis.gavinwye.com/pull/10))
- The panel lists comments in the order they appear on the page, and clicking one scrolls the page to its words or pin. ([#10](https://github.com/gavinwye/notis.gavinwye.com/pull/10))
- Servers for Netlify, Cloudflare Workers and plain Node, built from one host-free core, with single-file downloads at `/server/<host>.mjs`. ([#19](https://github.com/gavinwye/notis.gavinwye.com/pull/19))
- Events `comments:created`, `comments:replied` and `comments:resolved`, and `window.NotisVersion`. ([#19](https://github.com/gavinwye/notis.gavinwye.com/pull/19))
- `install.md` and `llms.txt`, so a coding agent can add Notis to a site. ([#19](https://github.com/gavinwye/notis.gavinwye.com/pull/19))
- Issue forms for bugs and ideas, `SECURITY.md` and `CONTRIBUTING.md`. ([#19](https://github.com/gavinwye/notis.gavinwye.com/pull/19))
- Immutable versioned files at `/v<version>/` with a Subresource Integrity hash, `version.json`, and package metadata for `@gavinwye/notis`. ([#36](https://github.com/gavinwye/notis.gavinwye.com/issues/36))

### Changed
- Square corners and a yellow accent throughout. The panel is always dark text on white, so it stays readable on dark pages. ([#10](https://github.com/gavinwye/notis.gavinwye.com/pull/10))
- Each comment is stored as its own record, so two reviewers commenting at once don't overwrite each other. The Netlify server moves an older single-blob store across on first read. ([#19](https://github.com/gavinwye/notis.gavinwye.com/pull/19))
- Renamed to **Notis**, at notis.gavinwye.com.

### Fixed
- Comments that overlap or sit inside each other now all get a highlight, and the panel lists them in page order. Before, the earlier comment in an overlap lost its highlight. Overlapping spots look stronger, and tapping one cycles through its comments. ([#47](https://github.com/gavinwye/notis.gavinwye.com/pull/47))
- On a phone the panel is a full-width sheet with 16px fields, so Safari no longer zooms in, and nothing runs off the edge. ([#47](https://github.com/gavinwye/notis.gavinwye.com/pull/47))
- Comments whose text spans paragraphs or list items are found again, so they highlight and the sidebar can scroll to them. ([#10](https://github.com/gavinwye/notis.gavinwye.com/pull/10))

## [0.1.0] - 2026-10-10

**In short:** the first version, taken from the copies already in use on several sites: select text, leave a note, reply, and resolve it.

**What to do:** nothing. This was the first release.

### Added
- Select text on a page and leave a comment. Threads with replies, resolve and reopen, and a toggle for resolved ones.
- Comments re-attach to their text using a quote with 32 characters either side, and show a notice when the text has changed.
- Options `apiBase`, `pageId`, `root`, `dock` and `supabase`, and the events `gtc:select`, `gtc:focus` and `gtc:close`.
- A Netlify function with server-owned ids, field caps, an admin token for deleting, and a CORS allowlist.

### Changed
- Removed project-specific names: neutral event, class and storage-key prefixes (`comments:*`, `cmt-*`), and the licence holder is Gavin Wye. ([#9](https://github.com/gavinwye/notis.gavinwye.com/pull/9))

[0.4.0]: https://github.com/gavinwye/notis.gavinwye.com/compare/v0.3.2...v0.4.0
[0.3.2]: https://github.com/gavinwye/notis.gavinwye.com/releases/tag/v0.3.2
[0.3.1]: https://github.com/gavinwye/notis.gavinwye.com/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/gavinwye/notis.gavinwye.com/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/gavinwye/notis.gavinwye.com/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/gavinwye/notis.gavinwye.com/releases/tag/v0.1.0
