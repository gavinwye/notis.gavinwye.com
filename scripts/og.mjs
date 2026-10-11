// Renders site-src/og.html to site/og.png (1200x630).
//   node scripts/og.mjs
// Needs Playwright and Chrome. Override with PLAYWRIGHT_MODULE and CHROME_PATH.
import { pathToFileURL, fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "/home/gavin/worker-runtime/node_modules/playwright-core/index.mjs");
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome" });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.goto(pathToFileURL(join(root, "site-src", "og.html")).href);
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(400);
await page.screenshot({ path: join(root, "site", "og.png") });
await browser.close();
console.log("wrote site/og.png");
