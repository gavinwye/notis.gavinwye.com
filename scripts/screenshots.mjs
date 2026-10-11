// Takes the README screenshots from the site's demo page (comments kept in the
// browser, invented content only).
//
//   cp public/comments.js site/comments.js     # gitignored copy the page loads
//   node scripts/screenshots.mjs
//
// Needs Playwright and Chrome. Override with PLAYWRIGHT_MODULE and CHROME_PATH.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, extname } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const site = join(root, "site");
const out = join(root, "docs", "images");
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
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
await page.goto(base);
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(500);

async function select(selector) {
  await page.evaluate((s) => {
    const el = document.querySelector(s);
    el.scrollIntoView({ block: "center" });
    const r = document.createRange();
    r.selectNodeContents(el);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  }, selector);
  await page.waitForSelector(".cmt-selbtn");
}
async function comment(text, { open = true } = {}) {
  await page.click(".cmt-selbtn");
  if (!(await page.inputValue("#cmt-name"))) await page.fill("#cmt-name", "Sam");
  await page.fill("#cmt-new", text);
  return open;
}
const post = async () => { await page.click(".cmt-composer .cmt-btn"); await page.waitForTimeout(400); };
const clipAround = async (box, pad = 24) => ({
  x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad),
  width: Math.min(1200 - Math.max(0, box.x - pad), box.width + pad * 2),
  height: Math.min(800 - Math.max(0, box.y - pad), box.height + pad * 2),
});

// 1. The comment box, with a name and a comment typed in.
await select("#why-it-exists p:nth-of-type(1)");
await comment("This says 'by email' but the next sentence says 'by post'. Which is it?");
const composer = await page.locator(".cmt-composer").boundingBox();
const quoteBox = await page.evaluate(() => {
  const r = getSelection().rangeCount ? getSelection().getRangeAt(0).getBoundingClientRect() : null;
  return r && { x: r.x, y: r.y, width: r.width, height: r.height };
});
const top = Math.min(composer.y, quoteBox ? quoteBox.y : composer.y);
const bottom = composer.y + composer.height;
await page.screenshot({
  path: join(out, "comment-box.png"),
  clip: await clipAround({ x: 40, y: top, width: 1120, height: bottom - top }, 16),
});
await post();

// A second comment on other words.
await select("#how-it-works li:nth-of-type(2)");
await comment("Is 'resolve' what the reviewer or the author does?");
await post();

// A pin on the wireframe's button.
await page.click(".cmt-pinbtn");
const img = page.locator("img[alt^='Wireframe']");
await img.scrollIntoViewIfNeeded();
const box = await img.boundingBox();
await page.mouse.click(box.x + box.width * 0.31, box.y + box.height * 0.82);
await page.fill("#cmt-name", "Sam");
await page.fill("#cmt-new", "The button should say 'Apply', not 'Continue'.");
await post();
await page.waitForTimeout(300);

// 2. The panel with three comments, one of them a pin.
await page.evaluate(() => scrollTo(0, 0));
await page.locator("#how-it-works").scrollIntoViewIfNeeded();
await page.waitForTimeout(500);
await page.screenshot({ path: join(out, "panel.png") });

// 3. The pin on the image, with the panel closed.
await page.click(".cmt-head [aria-label=\"Close notes\"]");
await page.waitForTimeout(400);
await img.scrollIntoViewIfNeeded();
await page.evaluate(() => { const el = document.querySelector("img[alt^='Wireframe']"); el.scrollIntoView({ block: "center" }); });
await page.waitForTimeout(500);
const imgBox = await img.boundingBox();
await page.screenshot({ path: join(out, "pin.png"), clip: await clipAround(imgBox, 16) });

await browser.close();
server.close();
console.log("wrote", ["comment-box.png", "panel.png", "pin.png"].map((f) => join("docs/images", f)).join(", "));
