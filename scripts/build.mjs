// Builds one self-contained file per host, so someone can download a single
// file and drop it into their project: server/netlify.mjs, cloudflare.mjs,
// node.mjs. In the repo the adapters import ./core.mjs; here that import line
// is replaced with the core itself.
//
//   node scripts/build.mjs [outDir]      (default: site/server)
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = process.argv[2] || join(root, "site", "server");
const IMPORT = 'import { createHandler } from "./core.mjs";';

const core = (await readFile(join(root, "server", "core.mjs"), "utf8")).replace(/^export /gm, "");
await mkdir(out, { recursive: true });

for (const host of ["netlify", "cloudflare", "node"]) {
  const src = await readFile(join(root, "server", `${host}.mjs`), "utf8");
  if (!src.includes(IMPORT)) throw new Error(`${host}.mjs has no core import to replace`);
  const built = src.replace(IMPORT, `// ---- Notis core (from server/core.mjs) ----\n${core}\n// ---- end of core ----`);
  await writeFile(join(out, `${host}.mjs`), built);
  console.log("built", join(out, `${host}.mjs`));
}
