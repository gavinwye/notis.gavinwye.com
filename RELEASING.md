# Releasing

How to release a version of Notis. Nothing here is done automatically, and a release needs Gavin: tagging, GitHub releases and npm publishing use his accounts.

A released version is immutable. Its files live at `https://notis.gavinwye.com/v<version>/` forever, and the site build refuses to change them.

## Steps

1. **Pick the version** (semantic: fixes `0.2.1`, features `0.3.0`, breaking changes `1.0.0`).
2. **Set it in both places.** `package.json` `version` and `var VERSION = "x.y.z";` at the top of `public/comments.js`. The build stops if they differ.
3. **Update `CHANGELOG.md`.** Move the entries from the unreleased section under the new version and date, and add the link at the bottom.
4. **Check.** `npm test`, then `node scripts/build.mjs --site /tmp/notis-site` and look at `/tmp/notis-site/version.json`.
5. **Merge to `main`** through a pull request. The site deploys and publishes `/v<version>/…` and updates the unversioned files.
6. **Archive the version.** From a clean checkout of `main`:

   ```bash
   mkdir -p /tmp/notis-site && node scripts/build.mjs --site /tmp/notis-site
   cp -r /tmp/notis-site/v<version> releases/
   ```

   Commit `releases/v<version>/` in a pull request and merge it. From then on the site republishes those exact files on every deploy, and any change to the source of that version fails the build.
7. **Tag and release on GitHub.**

   ```bash
   git tag v<version> && git push origin v<version>
   gh release create v<version> --title "v<version>" --notes-file <(sed -n '/^## \[<version>\]/,/^## \[/p' CHANGELOG.md | sed '$d')
   ```

8. **Publish to npm.** Log in once with `npm login`, then:

   ```bash
   npm publish --access public
   ```

   `prepack` builds `dist/` first. Check `npm pack --dry-run` lists `dist/comments.js`, `dist/server/*.mjs` and `server/*.mjs`.
9. **Check it.** Open `https://notis.gavinwye.com/v<version>/comments.js` and confirm the response header `cache-control: public, max-age=31536000, immutable`, and that `version.json` shows the new version.

## If a released version has a bug

Don't edit the released files. Fix it, release the next version, and say so in the changelog.
