import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, cp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { ROOT, widgetVersion, assertVersionsMatch, sri, buildSite } from "../scripts/lib.mjs";

const widget = (v) => `(function(){\n  var VERSION = "${v}";\n  window.NotisVersion = VERSION;\n})();`;

test("widgetVersion reads the version line", () => {
  assert.equal(widgetVersion(widget("1.2.3")), "1.2.3");
  assert.throws(() => widgetVersion("no version here"), /no `var VERSION/);
});

test("a mismatch between package.json and the widget stops the build", () => {
  assert.equal(assertVersionsMatch("0.2.0", widget("0.2.0")), "0.2.0");
  assert.throws(() => assertVersionsMatch("0.1.0", widget("0.2.0")), /Version mismatch.*0\.1\.0.*0\.2\.0/);
});

test("the repo's own versions match", async () => {
  const pkg = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8"));
  assert.equal(assertVersionsMatch(pkg.version, await readFile(join(ROOT, "public", "comments.js"), "utf8")), pkg.version);
});

test("sri is sha384 base64 of the bytes", () => {
  const bytes = Buffer.from("hello");
  assert.equal(sri(bytes), "sha384-" + createHash("sha384").update(bytes).digest("base64"));
});

// A small copy of the repo layout the build reads, so tests can change versions.
async function fixture(version = "0.2.0") {
  const root = await mkdtemp(join(tmpdir(), "notis-build-"));
  await mkdir(join(root, "public"), { recursive: true });
  await cp(join(ROOT, "server"), join(root, "server"), { recursive: true });
  await writeFile(join(root, "public", "comments.js"), widget(version));
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "x", version }));
  return root;
}

test("buildSite writes current and versioned files, with a matching hash", async () => {
  const root = await fixture("0.2.0");
  const site = join(root, "site");
  await mkdir(site);
  const info = await buildSite(site, root);
  assert.equal(info.version, "0.2.0");
  const js = await readFile(join(site, "v0.2.0", "comments.js"));
  assert.equal(info.integrity, sri(js));
  assert.equal((await readFile(join(site, "v0.2.0", "comments.js.sri"), "utf8")).trim(), info.integrity);
  assert.match(await readFile(join(site, "v0.2.0", "snippet.html"), "utf8"), /integrity="sha384-[^"]+" crossorigin="anonymous"/);
  assert.deepEqual(await readFile(join(site, "comments.js")), js);
  for (const h of ["netlify", "cloudflare", "node"]) {
    const a = await readFile(join(site, "server", `${h}.mjs`));
    const b = await readFile(join(site, "v0.2.0", "server", `${h}.mjs`));
    assert.deepEqual(a, b);
    assert.ok(a.toString().includes("createHandler"));
    assert.ok(!a.toString().includes('from "./core.mjs"'), "core should be inlined");
  }
  assert.equal(JSON.parse(await readFile(join(site, "version.json"), "utf8")).version, "0.2.0");
  await rm(root, { recursive: true });
});

test("buildSite refuses mismatched versions", async () => {
  const root = await fixture("0.2.0");
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "x", version: "0.3.0" }));
  await assert.rejects(buildSite(join(root, "site"), root), /Version mismatch/);
  await rm(root, { recursive: true });
});

test("a released version is republished as archived and cannot change", async () => {
  const root = await fixture("0.2.0");
  const site = join(root, "site");
  await mkdir(site);
  await buildSite(site, root);
  // Archive it, as RELEASING.md describes.
  await mkdir(join(root, "releases"), { recursive: true });
  await cp(join(site, "v0.2.0"), join(root, "releases", "v0.2.0"), { recursive: true });

  const again = join(root, "site2");
  await mkdir(again);
  await buildSite(again, root); // unchanged source: fine
  assert.ok(await readFile(join(again, "v0.2.0", "comments.js")));

  // Change the source without bumping the version: the build must stop.
  await writeFile(join(root, "public", "comments.js"), widget("0.2.0") + "\n// edited");
  await assert.rejects(buildSite(join(root, "site3"), root), /already released/);

  // Bump to 0.3.0: old files stay, new ones appear.
  await writeFile(join(root, "public", "comments.js"), widget("0.3.0"));
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "x", version: "0.3.0" }));
  const next = join(root, "site4");
  await mkdir(next);
  await buildSite(next, root);
  assert.ok(await readFile(join(next, "v0.2.0", "comments.js")));
  assert.ok(await readFile(join(next, "v0.3.0", "comments.js")));
  await rm(root, { recursive: true });
});
