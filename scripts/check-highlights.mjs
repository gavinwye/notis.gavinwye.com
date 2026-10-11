// Browser checks for highlighting and ordering: comments that overlap, nest,
// repeat or sit side by side must each keep a highlight, and the panel must
// list them in the order they appear on the page. Run by hand, not in CI:
//
//   node scripts/check-highlights.mjs
//
// Needs Playwright and Chrome. By default it uses the copy on this machine;
// point PLAYWRIGHT_MODULE at any playwright / playwright-core index.mjs, and
// CHROME at a Chrome binary:
//
//   PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs CHROME=/usr/bin/google-chrome \
//     node scripts/check-highlights.mjs
//
// WIDGET=/path/to/comments.js checks another copy of the widget (for example
// an older one, to see the checks fail).
//
// It copies public/comments.js next to a small fixture page in a temp folder
// and keeps comments in the browser (apiBase: null), so nothing is deployed.
import { mkdtemp, copyFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PW = process.env.PLAYWRIGHT_MODULE || "/home/gavin/worker-runtime/node_modules/playwright-core/index.mjs";
const CHROME = process.env.CHROME || "/usr/bin/google-chrome";
const { chromium } = await import(PW);
const here = dirname(fileURLToPath(import.meta.url));

const IMG = "data:image/svg+xml;utf8," + encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='240' height='120'><rect width='240' height='120' fill='#ddd'/></svg>");
const FIXTURE = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>fixture</title></head><body><main>
<h1>Review a page</h1>
<p id="p1">Select text on any page and say what you think of it. The comment stays attached to those words.</p>
<p id="p2">Notice that page appears here, and the word think appears again: think twice about page layout.</p>
<img id="im" src="${IMG}" alt="Grey box" width="240" height="120">
<ul><li id="l1">First item with <b>bold words</b> in it</li><li id="l2">Second item, plain</li></ul>
<p id="p3">The end of the page: say what you think.</p>
</main>
<script>window.COMMENTS_CONFIG={apiBase:null,pageId:"fixture"}</script>
<script src="comments.js" defer></script></body></html>`;

const dir = await mkdtemp(join(tmpdir(), "notis-hl-"));
await copyFile(process.env.WIDGET || join(here, "..", "public", "comments.js"), join(dir, "comments.js"));
await writeFile(join(dir, "index.html"), FIXTURE);
const URL_ = pathToFileURL(join(dir, "index.html")).href;

const browser = await chromium.launch({ executablePath: CHROME });
let failures = 0, checks = 0;
const ok = (cond, label) => { checks++; if (!cond) failures++; console.log((cond ? "  ok   " : "  FAIL ") + label); };

async function open(touch) {
  const ctx = await browser.newContext(touch
    ? { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }
    : { viewport: { width: 1100, height: 800 } });
  const page = await ctx.newPage();
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  await page.goto(URL_);
  await page.waitForSelector(".cmt-toggle", { state: "attached" });
  return { ctx, page };
}

// Select the nth occurrence of `text` inside the element at `sel`, like a reader would.
async function select(page, touch, sel, text, nth = 0) {
  const where = await page.evaluate(({ sel, text, nth }) => {
    const root = document.querySelector(sel);
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => n.parentElement.closest("[data-cmt]:not(mark.cmt-hl):not(mark.cmt-pending)")
        ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
    const nodes = []; let n, all = "";
    while ((n = w.nextNode())) { nodes.push({ n, at: all.length }); all += n.nodeValue; }
    let from = -1;
    for (let i = 0; i <= nth; i++) from = all.indexOf(text, from + 1);
    if (from < 0) return null;
    const locate = (g) => { for (let i = nodes.length - 1; i >= 0; i--) if (nodes[i].at <= g) return [nodes[i].n, g - nodes[i].at]; };
    const [sn, so] = locate(from), [en, eo] = locate(from + text.length - 1);
    const r = document.createRange(); r.setStart(sn, so); r.setEnd(en, eo + 1);
    root.scrollIntoView({ block: "center" });
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    // global position of the words in the page's text, for the expected order
    const pre = document.createRange(); pre.setStart(document.querySelector("main"), 0); pre.setEnd(sn, so);
    return pre.toString().length;
  }, { sel, text, nth });
  if (where == null) throw new Error(`"${text}" not found in ${sel}`);
  if (touch) await page.evaluate(() => document.dispatchEvent(new Event("selectionchange")));
  else await page.evaluate((sel) => document.querySelector(sel).dispatchEvent(new MouseEvent("mouseup", { bubbles: true })), sel);
  return where;
}

// Select words, open the composer, post. Returns the new comment's id.
async function comment(page, touch, sel, text, body, nth = 0) {
  const pos = await select(page, touch, sel, text, nth);
  await page.waitForSelector(touch ? ".cmt-selbar" : ".cmt-selbtn", { timeout: 4000 });
  await page.click(touch ? ".cmt-selbar" : ".cmt-selbtn");
  if (touch) {
    if (await page.locator("#cmt-name").isVisible()) {
      await page.fill("#cmt-name", "Sam");
      await page.click('.cmt-sheet button.cmt-btn:text-is("Next")');
    }
    await page.fill("#cmt-new", body);
    await page.click('.cmt-sheet button.cmt-btn:text-is("Comment")');
  } else {
    if (!(await page.inputValue("#cmt-name"))) await page.fill("#cmt-name", "Sam");
    await page.fill("#cmt-new", body);
    await page.click(".cmt-composer .cmt-btn");
  }
  await page.waitForFunction((b) => [...document.querySelectorAll(".cmt-body")].some((e) => e.textContent === b), body);
  await page.waitForTimeout(80);
  const id = await page.evaluate((b) => {
    const t = [...document.querySelectorAll(".cmt-thread")].find((e) => e.querySelector(".cmt-body").textContent === b);
    return t && t.dataset.thread;
  }, body);
  return { id, pos, body };
}

async function state(page) {
  return page.evaluate(() => ({
    marked: [...new Set([...document.querySelectorAll("mark.cmt-hl")].flatMap((m) => (m.dataset.threads || m.dataset.thread).split(" ")))],
    panel: [...document.querySelectorAll(".cmt-thread")].map((e) => e.dataset.thread),
    bodies: [...document.querySelectorAll(".cmt-thread")].map((e) => e.querySelector(".cmt-body").textContent),
    leftovers: document.querySelectorAll("mark.cmt-pending").length,
    lost: document.querySelectorAll(".cmt-lost").length,
  }));
}

// Every comment highlighted, panel in page order; then again after a reload.
async function assertAll(page, created, label, openPanel) {
  const expected = [...created].sort((a, b) => a.pos - b.pos || created.indexOf(a) - created.indexOf(b)).map((c) => c.body);
  for (const when of ["after posting", "after reload"]) {
    if (when === "after reload") {
      await page.reload(); await page.waitForSelector(".cmt-toggle", { state: "attached" });
      if (!(await page.locator(".cmt-panel.cmt-open").count())) await page.click(".cmt-toggle");
      await page.waitForTimeout(150);
    }
    const s = await state(page);
    const missing = created.filter((c) => !s.marked.includes(c.id)).map((c) => c.body);
    ok(missing.length === 0, `${label}: every comment highlighted ${when}` + (missing.length ? ` (missing: ${missing.join(", ")})` : ""));
    ok(JSON.stringify(s.bodies) === JSON.stringify(expected), `${label}: panel in page order ${when}` +
      (JSON.stringify(s.bodies) === JSON.stringify(expected) ? "" : `\n         got      ${JSON.stringify(s.bodies)}\n         expected ${JSON.stringify(expected)}`));
    ok(s.lost === 0 && s.leftovers === 0, `${label}: no "text has changed" notices or stray pending marks ${when}`);
  }
}

async function scenario(touch, label, steps) {
  const { ctx, page } = await open(touch);
  const created = [];
  try {
    for (const [sel, text, body, nth] of steps) created.push(await comment(page, touch, sel, text, body, nth || 0));
    await assertAll(page, created, label);
    ok(page.errors.length === 0, `${label}: no page errors` + (page.errors.length ? " " + page.errors.join("; ") : ""));
  } catch (e) {
    // a step that cannot be done at all (for example, no Comment button appears) is a failure too
    ok(false, `${label}: stopped at comment ${created.length + 1} (${String(e.message).split("\n")[0]})`);
  }
  await ctx.close();
}

try {
  console.log("Desktop");
  await scenario(false, "(a) three apart, bottom to top", [
    ["#p3", "say what you think", "a-bottom"], ["#l1", "bold words", "a-middle"], ["#p1", "Select text", "a-top"]]);
  await scenario(false, "(b) nested", [
    ["#p1", "say what you think", "b-long"], ["#p1", "think", "b-inside"]]);
  await scenario(false, "(c) partial overlap", [
    ["#p1", "say what you", "c-first"], ["#p1", "you think of it", "c-second"]]);
  await scenario(false, "(d) identical range twice", [
    ["#p1", "stays attached", "d-one"], ["#p1", "stays attached", "d-two"]]);
  await scenario(false, "(e) adjacent words", [
    ["#p1", "Select", "e-one"], ["#p1", "text", "e-two"], ["#p1", "on any", "e-three"]]);
  await scenario(false, "(f) the second of two identical words", [
    ["#p1", "think", "f-first"], ["#p2", "think", "f-third", 1]]);
  await scenario(false, "(h) across two list items, then inside one", [
    ["#l1", "bold words in it", "h-a"], ["#p3", "The end", "h-b"], ["#p2", "page", "h-c", 1]]);

  console.log("Phone (390x844, touch)");
  await scenario(true, "(g1) three apart, bottom to top", [
    ["#p3", "say what you think", "g-bottom"], ["#l1", "bold words", "g-middle"], ["#p1", "Select text", "g-top"]]);
  await scenario(true, "(g2) nested and overlapping", [
    ["#p1", "say what you think", "g-long"], ["#p1", "think", "g-inside"], ["#p1", "page and say", "g-over"]]);

  console.log("Resolve, replies, scroll, pins");
  {
    const { ctx, page } = await open(false);
    const a = await comment(page, false, "#p1", "say what you think", "x-long");
    const b = await comment(page, false, "#p1", "think", "x-inside");
    // pin on the image, between p2 and the list in the page
    await page.click(".cmt-pinbtn");
    const box = await page.locator("#im").boundingBox();
    await page.mouse.click(box.x + 60, box.y + 40);
    await page.fill("#cmt-new", "x-pin");
    await page.click(".cmt-composer .cmt-btn");
    await page.waitForFunction(() => [...document.querySelectorAll(".cmt-body")].some((e) => e.textContent === "x-pin"));
    const c = await comment(page, false, "#p3", "end of the page", "x-end");
    let s = await state(page);
    ok(JSON.stringify(s.bodies) === JSON.stringify(["x-long", "x-inside", "x-pin", "x-end"]), "pin sits between the text above and below it: " + s.bodies.join(", "));

    // resolve the long one: its highlight goes, "think" keeps its own
    await page.locator(`.cmt-thread[data-thread="${a.id}"] .cmt-actions button`, { hasText: "Resolve" }).click();
    await page.waitForTimeout(150);
    s = await state(page);
    ok(!s.marked.includes(a.id) && s.marked.includes(b.id), "resolved comment hides its highlight, the nested one keeps its own");
    await page.check("#cmt-showres");
    await page.waitForTimeout(150);
    s = await state(page);
    ok(s.marked.includes(a.id) && s.bodies[0] === "x-long", "show resolved brings it back, still first");
    await page.locator(`.cmt-thread[data-thread="${a.id}"] .cmt-actions button`, { hasText: "Reopen" }).click();
    await page.waitForTimeout(150);

    // reply, then click-to-scroll from the panel
    await page.locator(`.cmt-thread[data-thread="${b.id}"] .cmt-actions button`, { hasText: "Reply" }).click();
    await page.fill(`#cmt-reply-${b.id}`, "a reply");
    await page.locator(`.cmt-thread[data-thread="${b.id}"] .cmt-reply .cmt-btn`).click();
    await page.waitForTimeout(150);
    ok((await page.locator(`.cmt-thread[data-thread="${b.id}"] .cmt-body`).allTextContents()).includes("a reply"), "reply is posted");
    await page.evaluate(() => scrollTo(0, 0)); await page.waitForTimeout(150);
    await page.locator(`.cmt-thread[data-thread="${c.id}"] .cmt-body`).click();
    await page.waitForTimeout(1200);
    const inView = await page.evaluate((id) => {
      const r = document.querySelector(`mark.cmt-hl[data-threads~="${id}"], mark.cmt-hl[data-thread="${id}"]`).getBoundingClientRect();
      return r.top >= 0 && r.bottom <= innerHeight;
    }, c.id);
    ok(inView, "clicking a comment scrolls its words into view");

    // clicking where two comments overlap moves through them, newest first
    await page.evaluate(() => scrollTo(0, 0)); await page.waitForTimeout(150);
    const target = page.locator(`mark.cmt-hl[data-threads~="${b.id}"], mark.cmt-hl[data-thread="${b.id}"]`).first();
    await target.scrollIntoViewIfNeeded();
    await target.click({ position: { x: 3, y: 3 } });
    await page.waitForTimeout(100);
    const first = await page.evaluate(() => document.querySelector(".cmt-thread.cmt-active")?.dataset.thread);
    await target.click({ position: { x: 3, y: 3 } });
    await page.waitForTimeout(100);
    const second = await page.evaluate(() => document.querySelector(".cmt-thread.cmt-active")?.dataset.thread);
    ok(first === b.id && second === a.id, "repeated clicks on overlapping words move through the comments");
    ok(page.errors.length === 0, "no page errors" + (page.errors.length ? " " + page.errors.join("; ") : ""));
    await ctx.close();
  }
} finally {
  await browser.close();
  await rm(dir, { recursive: true, force: true });
}
console.log(`\n${checks - failures} of ${checks} checks passed`);
process.exit(failures ? 1 : 0);
