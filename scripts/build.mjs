// Builds what Notis publishes.
//
//   node scripts/build.mjs --site <dir>   the website's generated files, including
//                                         the versioned, immutable /v<version>/ copies
//   node scripts/build.mjs --package      dist/ for the npm package
//   node scripts/build.mjs [outDir]       just the three single-file servers
//                                         (default: site/server)
//
// package.json and public/comments.js must say the same version, or the build
// stops. See RELEASING.md.
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { ROOT, buildSite, buildPackage, serverSources, HOSTS } from "./lib.mjs";

const args = process.argv.slice(2);
try {
  if (args[0] === "--site") {
    const info = await buildSite(args[1] || ".");
    console.log(`built site files for v${info.version} (${info.integrity.slice(0, 18)}...)`);
  } else if (args[0] === "--package") {
    await buildPackage();
    console.log("built dist/");
  } else {
    const out = args[0] || join(ROOT, "site", "server");
    const servers = await serverSources();
    await mkdir(out, { recursive: true });
    for (const host of HOSTS) {
      await writeFile(join(out, `${host}.mjs`), servers[host]);
      console.log("built", join(out, `${host}.mjs`));
    }
  }
} catch (err) {
  console.error(String(err.message || err));
  process.exit(1);
}
