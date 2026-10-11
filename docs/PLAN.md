# Publishing plan

Goal: someone can find this, understand it in a minute, try it, and put it on their own page in ten.

Issues for each step are in the repo. Estimates are raw; no calibration is trusted yet (`velocity.json` has 1 issue).

## Where things live

| What | Where |
|---|---|
| Code, README, issues | GitHub: `gavinwye/notis.gavinwye.com` (private until step 6) |
| Website | Netlify project `notis-gavinwye`, base dir `site/`, domain `notis.gavinwye.com`; production deploys from `main`, every PR gets a deploy preview |
| Blog post | drafted in the publisher desk (draft `imv2oih9lf5`, "Reviewing a page by commenting on the exact words"; copy in `docs/blog-post.md`), then a PR on `gavinwye/gavinwye.com` |
| Local folder | `~/com.gavinwye.notis` |

## Deploys

- `main` deploys to production. Every PR gets a deploy preview, and Netlify posts the link as a PR comment, a check and a commit status.
- The Netlify site has no function. The demo on the site keeps comments in the browser only.
- A change to `public/comments.js` rebuilds the site as well as a change under `site/`.

## Which version this is

The newest copy in use, with the other sites' project-specific settings left out:

- Widget: dock mode, events, a "text has changed" notice, and styles that don't inherit the host page's line-height and italics.
- Server: the hardened standalone version (server owns ids, field caps, admin token, CORS allowlist).
- Prefix: events are `comments:*`, classes `cmt-*`, attributes `data-cmt`.

## Decisions for Gavin before it goes public

1. **Name.** Decided: Notis (Swedish for a short note). Technical names (`comments.js`, `/api/comments`, `comments:*` events, `COMMENTS_*` settings) stay as they are, because they say what the thing does and other sites already use them.
2. **Font.** The panel uses Figtree. Fine as a default, but should be a setting.

## Steps

| # | Step | Raw estimate | Needs Gavin |
|---|---|---|---|
| 1 | ~~Decide licence holder and name~~ done: Gavin Wye, Notis | 15m | |
| 2 | ~~Rename the old project prefix~~ done | 1h | |
| 3 | Make font and accent colour settings | 1h | |
| 4 | Tests: function (a version exists, needs a Blobs stub) and widget (select, comment, reload) | 2h | |
| 5 | ~~Deploy the website, then DNS for `notis.gavinwye.com`~~ done: Netlify project `notis-gavinwye` linked to this repo (base dir `site`), PRs get deploy previews | 30m | |
| 6 | Make the repo public, tag `v0.1.0`, add topics and a social image | 15m | yes |
| 7 | Review the blog post on a preview, take `draft: true` out, merge | 30m | yes |
| 8 | Point the other sites at one versioned copy instead of five | 2h | |

Order: 1 → 2 → 3 → 4 → 5 → 6 → 7. Step 8 can wait; it's tidying, not launch.

## Launch week (after Gavin shares it)

- Tuesday: the blog post, then a LinkedIn line pointing at it. Cadence says post Tuesday.
- Link the post from the site and the site from the post, so each one lands somewhere.
- Watch for: GitHub issues, "how do I add auth?" (answer in README: it doesn't), and anyone running it on a public page.

## Risks

- **An open endpoint.** Anyone with the URL can post to a deployed function. `COMMENTS_ALLOWED_ORIGINS` helps against browsers, not curl. The README says so; keep saying it.
- **Lost writes.** All threads sit in one blob, so simultaneous writes can clobber each other. Fine for a few reviewers. If it gets real use, move to one blob per thread.
- **Nobody else's data.** Don't put real comments from other sites in the demo or screenshots.
