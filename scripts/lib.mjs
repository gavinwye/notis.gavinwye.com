// The build, as functions, so tests can call it. scripts/build.mjs is the CLI.
import { readFile, writeFile, mkdir, cp, readdir, stat, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const HOSTS = ["netlify", "cloudflare", "node"];
export const SITE_URL = process.env.NOTIS_SITE_URL || "https://notis.gavinwye.com";
const IMPORT = 'import { createHandler } from "./core.mjs";';

/** The version the widget reports as NotisVersion, read from its source. */
export function widgetVersion(source) {
  const m = /var VERSION = "([0-9]+\.[0-9]+\.[0-9]+[^"]*)";/.exec(source);
  if (!m) throw new Error('public/comments.js has no `var VERSION = "x.y.z";` line');
  return m[1];
}

/** Throws unless package.json and the widget say the same version. */
export function assertVersionsMatch(pkgVersion, widgetSource) {
  const widget = widgetVersion(widgetSource);
  if (pkgVersion !== widget) {
    throw new Error(
      `Version mismatch: package.json says ${pkgVersion} but public/comments.js says ${widget}. ` +
      `Make them the same before building (see RELEASING.md).`
    );
  }
  return widget;
}

export const sri = (bytes) => "sha384-" + createHash("sha384").update(bytes).digest("base64");

/** One self-contained file per host: the adapter with the core inlined. */
export async function serverSources(root = ROOT) {
  const core = (await readFile(join(root, "server", "core.mjs"), "utf8")).replace(/^export /gm, "");
  const out = {};
  for (const host of HOSTS) {
    const src = await readFile(join(root, "server", `${host}.mjs`), "utf8");
    if (!src.includes(IMPORT)) throw new Error(`${host}.mjs has no core import to replace`);
    out[host] = src.replace(IMPORT, `// ---- Notis core (from server/core.mjs) ----\n${core}\n// ---- end of core ----`);
  }
  return out;
}

async function exists(p) { try { await stat(p); return true; } catch { return false; } }

async function listFiles(dir, rel = "") {
  const out = [];
  for (const e of await readdir(join(dir, rel), { withFileTypes: true })) {
    const r = join(rel, e.name);
    if (e.isDirectory()) out.push(...(await listFiles(dir, r))); else out.push(r);
  }
  return out.sort();
}

async function sameFiles(dirA, dirB) {
  const a = await listFiles(dirA), b = await listFiles(dirB);
  if (a.join("\n") !== b.join("\n")) return false;
  for (const f of a) {
    if (!(await readFile(join(dirA, f))).equals(await readFile(join(dirB, f)))) return false;
  }
  return true;
}

/**
 * Writes everything the site publishes, under `site`:
 *   comments.js, server/<host>.mjs                          current, short cache
 *   v<version>/comments.js, comments.js.sri, snippet.html,
 *   v<version>/server/<host>.mjs                            this version, immutable
 *   version.json                                            what is current, and its hash
 * plus every archived release from releases/. A released version is never
 * rebuilt: if its source has changed since, the build stops.
 */
export async function buildSite(site, root = ROOT) {
  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const widget = await readFile(join(root, "public", "comments.js"));
  const version = assertVersionsMatch(pkg.version, widget.toString("utf8"));
  const servers = await serverSources(root);
  const integrity = sri(widget);
  const vdir = `v${version}`;

  const releases = join(root, "releases");
  if (await exists(releases)) {
    for (const e of await readdir(releases, { withFileTypes: true })) {
      if (e.isDirectory() && /^v\d/.test(e.name)) await cp(join(releases, e.name), join(site, e.name), { recursive: true });
    }
  }

  const stage = join(site, `.stage-${vdir}`);
  await rm(stage, { recursive: true, force: true });
  await mkdir(join(stage, "server"), { recursive: true });
  await writeFile(join(stage, "comments.js"), widget);
  await writeFile(join(stage, "comments.js.sri"), integrity + "\n");
  await writeFile(join(stage, "snippet.html"),
    `<script src="${SITE_URL}/${vdir}/comments.js" integrity="${integrity}" crossorigin="anonymous" defer></script>\n`);
  for (const host of HOSTS) await writeFile(join(stage, "server", `${host}.mjs`), servers[host]);

  const archived = join(releases, vdir);
  if (await exists(archived) && !(await sameFiles(archived, stage))) {
    await rm(stage, { recursive: true, force: true });
    throw new Error(`${vdir} is already released (releases/${vdir}) and the source has changed since. Bump the version.`);
  }

  await mkdir(join(site, vdir), { recursive: true });
  await cp(stage, join(site, vdir), { recursive: true });
  await rm(stage, { recursive: true, force: true });

  await writeFile(join(site, "comments.js"), widget);
  await mkdir(join(site, "server"), { recursive: true });
  for (const host of HOSTS) await writeFile(join(site, "server", `${host}.mjs`), servers[host]);

  const info = {
    version,
    script: `${SITE_URL}/${vdir}/comments.js`,
    integrity,
    snippet: `${SITE_URL}/${vdir}/snippet.html`,
    servers: Object.fromEntries(HOSTS.map((h) => [h, `${SITE_URL}/${vdir}/server/${h}.mjs`])),
  };
  await writeFile(join(site, "version.json"), JSON.stringify(info, null, 2) + "\n");
  return info;
}

/** What goes in the npm package: dist/comments.js and dist/server/<host>.mjs. */
export async function buildPackage(root = ROOT) {
  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const widget = await readFile(join(root, "public", "comments.js"));
  assertVersionsMatch(pkg.version, widget.toString("utf8"));
  const servers = await serverSources(root);
  await mkdir(join(root, "dist", "server"), { recursive: true });
  await writeFile(join(root, "dist", "comments.js"), widget);
  for (const host of HOSTS) await writeFile(join(root, "dist", "server", `${host}.mjs`), servers[host]);
}
