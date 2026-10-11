// Checks that the Notis site sets its type in the self-hosted Barlow files, makes
// no request to any other origin, and that the widget picks the same font up.
//
//   cp public/comments.js site/comments.js     # gitignored copy the page loads
//   node scripts/check-fonts.mjs [screenshotDir]
//
// Needs Playwright and Chrome. Override with PLAYWRIGHT_MODULE and CHROME_PATH.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, extname } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const site = join(root, "site");
const shots = process.argv[2] || null;
const types = { ".html": "text/html", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png", ".md": "text/markdown", ".woff2": "font/woff2", ".txt": "text/plain" };

const server = createServer(async (req, res) => {
  const p = req.url.split("?")[0];
  try {
    const body = await readFile(join(site, p === "/" ? "index.html" : p));
    res.writeHead(200, { "content-type": types[extname(p)] || "text/html" }).end(body);
  } catch { res.writeHead(404).end(); }
}).listen(0);
const base = `http://127.0.0.1:${server.address().port}/`;

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "/home/gavin/worker-runtime/node_modules/playwright-core/index.mjs");
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome" });

let failed = 0;
const ok = (cond, label, detail = "") => { console.log((cond ? "  ok   " : "  FAIL ") + label + (detail ? "  " + detail : "")); if (!cond) failed++; };

for (const [label, opts] of [["desktop", { viewport: { width: 1100, height: 800 } }], ["phone", { viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true }]]) {
  console.log("\n" + label);
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  // The only other origin the page may call is its own analytics (Umami, which does nothing off the production host).
  const external = [];
  page.on("request", (r) => { const u = r.url(); if (!u.startsWith(base) && !u.startsWith("data:") && !u.startsWith("https://umami.gvn.sh/")) external.push(u); });
  await page.goto(base);
  await page.waitForTimeout(600);
  const info = await page.evaluate(async () => {
    await document.fonts.ready;
    const loaded = [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family.replace(/["']/g, "") + " " + f.weight + (f.style === "italic" ? " italic" : ""));
    const first = (s) => getComputedStyle(document.querySelector(s)).fontFamily.split(",")[0].replace(/["']/g, "");
    const used = (fam, w) => document.fonts.check(`${w} 16px "${fam}"`);
    return {
      loaded: [...new Set(loaded)],
      body: first("body"), h1: first("h1"), h2: first("h2"), brand: first(".brand"), toggle: first(".cmt-toggle"),
      overflow: document.documentElement.scrollWidth - innerWidth,
      semiCondensed: used("Barlow Semi Condensed", 700), barlow: used("Barlow", 400),
    };
  });
  ok(external.length === 0, "no font or other request leaves the site", external.join(", "));
  ok(info.body === "Barlow", "body is Barlow", info.body);
  ok(info.h1 === "Barlow Semi Condensed" && info.h2 === "Barlow Semi Condensed" && info.brand === "Barlow Semi Condensed", "headings and brand are Barlow Semi Condensed");
  ok(info.barlow && info.semiCondensed, "both families report as loaded");
  ok(info.loaded.some((f) => f.startsWith("Barlow Semi Condensed 700")) && info.loaded.some((f) => f.startsWith("Barlow 400")), "the 400 and 700 files were fetched", info.loaded.join("; "));
  ok(info.overflow <= 0, "no sideways overflow", String(info.overflow));

  await page.click(".cmt-toggle");
  await page.waitForTimeout(300);
  const panel = await page.evaluate(() => getComputedStyle(document.querySelector(".cmt-panel")).fontFamily);
  ok(/Barlow/.test(panel), "the widget panel takes the page's font stack", panel.split(",").slice(0, 2).join(","));
  await page.click(".cmt-footclose");
  await page.waitForTimeout(200);
  if (shots) {
    await page.screenshot({ path: join(shots, `fonts-${label}.png`) });
    if (label === "phone") {
      await page.tap("#menu-toggle");
      await page.waitForTimeout(250);
      await page.screenshot({ path: join(shots, "fonts-phone-menu.png"), clip: { x: 0, y: 0, width: 390, height: 420 } });
    }
  }
  await ctx.close();
}

await browser.close();
server.close();
console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
