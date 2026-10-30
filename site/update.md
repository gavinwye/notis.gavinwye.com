# Update Notis in a site

Notis lets reviewers select text on a page, or drop a pin on an image, and leave a note. This guide is for updating a site that already has it. To add Notis for the first time, use https://notis.gavinwye.com/install.md. Source: https://github.com/gavinwye/notis.gavinwye.com (MIT).

You are an AI agent updating Notis in the user's site. A copied file stays exactly as it was, so the user has to ask for updates: that's what you're doing now. Follow these steps in order.

**Rules**
- Never overwrite the user's own settings (`COMMENTS_CONFIG`, `data-*` attributes, environment variables, secrets, `wrangler.toml`, `netlify.toml`).
- Never delete or reset stored notes. The update replaces code only. Notes live in the user's own store (Netlify Blobs, Cloudflare KV or the `COMMENTS_DIR` folder), and none of the steps below touch it.
- Never print, log or commit `COMMENTS_ADMIN_TOKEN` or any other secret.
- Ask before anything that deploys to production.

## 1. Find what the site has now

Look for each of these, and note the path:

| Part | Where to look |
|---|---|
| **The widget** | a file served as `comments.js` (often `public/comments.js`, `static/comments.js`, or the site root), a `<script src="…/comments.js">` tag, or a tag that loads from `notis.gavinwye.com` |
| **The server** | `netlify/functions/comments.mjs`, `cloudflare.mjs` or a Worker entry that mentions `COMMENTS`, or a Node file such as `notis-server.mjs` |
| **The npm package** | `@gavinwye/notis` in `package.json` |

A site can have the widget without a server (browser-only mode, `apiBase: null`). Say which parts you found.

If the project uses the npm package, update it with `npm update @gavinwye/notis` and go to step 5. The package is prepared but may not be published yet, so if the install fails, fall back to the steps below.

## 2. Read the version you have

**The widget** carries its version on a line near the top: `var VERSION = "x.y.z";`. Read it from the file itself. Don't guess from the date or from a script tag.

If the site loads the widget from `https://notis.gavinwye.com/v<version>/comments.js`, the version is in that address. If it loads the unversioned `https://notis.gavinwye.com/comments.js`, it already runs the newest widget: say so, and suggest copying a versioned file into the site instead (see install.md, step 2).

**The server file has no version line**, so find its version by comparing it with the published ones. Take the hash of the user's file:

```bash
openssl dgst -sha256 <path to the server file>
```

and compare it with the hash of the same host's file at each version in the changelog, oldest first:

```bash
curl -fsSL https://notis.gavinwye.com/v<version>/server/<netlify|cloudflare|node>.mjs | openssl dgst -sha256
```

The first match tells you the version (0.2.0 and 0.3.0 have the same server files, so either answer is right for them). If nothing matches, the user has changed the file. Say so, show the difference from the nearest version, and ask before replacing it.

## 3. Find out what's current, and what changed

Fetch https://notis.gavinwye.com/version.json:

```json
{ "version": "0.3.1",
  "script": "https://notis.gavinwye.com/v0.3.1/comments.js",
  "integrity": "sha384-…",
  "servers": {
    "netlify": "https://notis.gavinwye.com/v0.3.1/server/netlify.mjs",
    "cloudflare": "https://notis.gavinwye.com/v0.3.1/server/cloudflare.mjs",
    "node": "https://notis.gavinwye.com/v0.3.1/server/node.mjs" } }
```

If the site's version equals `version`, say "Notis is up to date" and stop.

Otherwise read https://raw.githubusercontent.com/gavinwye/notis.gavinwye.com/main/CHANGELOG.md. For each version after the one the site has, up to and including the current one, note:

- the **What to do** line at the top of the entry, which says which of the user's files must be replaced: the script on their pages (`comments.js`), the server file, or both. The **In short** line above it says what changed, in plain English;
- anything under *Security* (these must not be skipped), *Changed* or a note about settings, defaults or breaking behaviour.

If the repository is private and the changelog can't be fetched, say so and carry on: replace both files anyway.

Server updates can be security fixes. 0.3.1 protected the full export of every page's notes behind the admin token and added write limits, and it changed the server files on every host. A site on 0.3.0 or older is missing those, so never skip the server file because the widget looks fine.

## 4. Replace the files

Use the versioned addresses from `version.json`. They never change, so the same address always returns the same bytes. Don't use the unversioned `/comments.js` or `/server/…` addresses for a copy.

**The widget**, saved over the existing file at the same path:

```bash
curl -fsSL https://notis.gavinwye.com/v<version>/comments.js -o <path to the existing widget>
curl -fsSL https://notis.gavinwye.com/v<version>/comments.js.sri
# the second command's output is "sha384-" followed by the same text as:
openssl dgst -sha384 -binary <path to the existing widget> | openssl base64 -A
```

If the two don't match, stop and say so. Don't keep the file.

**The server**, for the user's host, from `servers` in `version.json`, saved over the existing server file:

```bash
curl -fsSL https://notis.gavinwye.com/v<version>/server/<netlify|cloudflare|node>.mjs -o <path to the existing server file>
```

Replace only the files you found in step 1. Keep the user's settings exactly as they were. If a changelog entry says a new setting exists (for example `COMMENTS_MAX_THREADS_PER_PAGE`), mention it in your report; don't add it unless the user asks.

If the site loads the widget from a `<script integrity="sha384-…">` tag, update both the version in the address and the `integrity` value from `version.json`, together.

## 5. Check it works

1. Run the site's own tests and build, if it has them.
2. Open a page, select a sentence, add a note, reload. The highlight and the note should still be there, and the notes that were there before should still be there.
3. For shared storage, `curl "<site>/api/comments?page=<pageId>"` returns JSON. The unfiltered `curl <site>/api/comments` (no `?page=`) should now answer `403` without the admin token if the site is on 0.3.1 or later.
4. Type `NotisVersion` in the browser console. It should show the new version.

Ask the user before deploying to production.

## 6. Report back

Say, in a few lines:

- the version you found, and the version you moved to;
- which files you replaced, and which you left alone;
- what changed that matters to them, taken from the changelog, and anything that needs a decision (a new setting, a changed default, something breaking);
- what you checked, and what you couldn't (for example, a deployed host);
- that notes were not touched.

If something doesn't work, the user can report it at https://github.com/gavinwye/notis.gavinwye.com/issues/new?template=bug_report.yml. Give them the version before and after, and which host they use.
