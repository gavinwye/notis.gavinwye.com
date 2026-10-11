# Changelog

All notable changes to Notis. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the version numbers follow [Semantic Versioning](https://semver.org/).

## [0.2.0] - 2026-10-11

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

First version in its own repository, taken from the copies in use on several sites.

### Added
- Select text on a page and leave a comment. Threads with replies, resolve and reopen, and a toggle for resolved ones.
- Comments re-attach to their text using a quote with 32 characters either side, and show a notice when the text has changed.
- Options `apiBase`, `pageId`, `root`, `dock` and `supabase`, and the events `gtc:select`, `gtc:focus` and `gtc:close`.
- A Netlify function with server-owned ids, field caps, an admin token for deleting, and a CORS allowlist.

### Changed
- Removed project-specific names: neutral event, class and storage-key prefixes (`comments:*`, `cmt-*`), and the licence holder is Gavin Wye. ([#9](https://github.com/gavinwye/notis.gavinwye.com/pull/9))

[0.2.0]: https://github.com/gavinwye/notis.gavinwye.com/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/gavinwye/notis.gavinwye.com/releases/tag/v0.1.0
