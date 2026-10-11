// Accessibility checks for the Notis widget. Run by hand, not in CI:
//
//   node scripts/check-a11y.mjs
//
// It drives the widget with the keyboard only (no mouse), then checks focus
// order and return, live-region announcements, roles and names, contrast
// (WCAG 2.2 AA numbers), target sizes, reduced motion, forced colours and a
// 200% zoom equivalent. It also runs axe-core if you point AXE_CORE at its
// axe.min.js (for example after `npm i --prefix /tmp/axe axe-core`).
//
// It can't replace a screen reader. VoiceOver, NVDA and TalkBack have not
// been run by this script.
//
//   PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs CHROME=/usr/bin/google-chrome \
//   AXE_CORE=/tmp/axe/node_modules/axe-core/axe.min.js node scripts/check-a11y.mjs
import { mkdtemp, copyFile, writeFile, readFile } from "node:fs/promises";
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
<p><a id="lnk" href="#p3">Skip to the end</a></p>
<p id="p1">Select text on any page and say what you think of it. The note stays attached to those words.</p>
<p id="p2">Notice that page appears here, and the word think appears again: think twice about page layout.</p>
<img id="im" src="${IMG}" alt="Grey box" width="240" height="120">
<p id="p3">The end of the page: say what you think.</p>
</main>
<script>window.COMMENTS_CONFIG={apiBase:null,pageId:"fixture"}</script>
<script src="comments.js" defer></script></body></html>`;

const dir = await mkdtemp(join(tmpdir(), "notis-a11y-"));
await copyFile(process.env.WIDGET || join(here, "..", "public", "comments.js"), join(dir, "comments.js"));
await writeFile(join(dir, "index.html"), FIXTURE);
const URL_ = pathToFileURL(join(dir, "index.html")).href;

const browser = await chromium.launch({ executablePath: CHROME });
let failures = 0, checks = 0;
const ok = (cond, label, extra = "") => { checks++; if (!cond) failures++; console.log((cond ? "  ok   " : "  FAIL ") + label + (extra ? "  [" + extra + "]" : "")); };
const section = (t) => console.log("\n" + t);

async function open(ctxOpts = { viewport: { width: 1100, height: 800 } }) {
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  await page.goto(URL_);
  await page.waitForSelector(".cmt-toggle", { state: "attached" });
  return page;
}
const live = (page) => page.evaluate(() => document.querySelector("body > .cmt-live").textContent);
const active = (page) => page.evaluate(() => {
  const a = document.activeElement;
  return a ? { tag: a.tagName, id: a.id || "", cls: a.className || "", text: (a.textContent || "").trim().slice(0, 40), label: a.getAttribute("aria-label") || "" } : null;
});
const settle = (page, ms = 150) => page.waitForTimeout(ms);
// Put a caret at the start of an element's text, then extend it with Shift+Arrow: the same keys a keyboard user presses.
async function selectWithKeys(page, selector, chars) {
  // Selection.modify is what Shift+Arrow does in the browser; the last step is a real key press
  // so the widget sees the same keyup a keyboard user would produce.
  await page.evaluate(({ sel, n }) => {
    const el = document.querySelector(sel);
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const node = w.nextNode();
    const s = getSelection(); s.removeAllRanges();
    s.collapse(node, 0);
    for (let i = 0; i < n - 1; i++) s.modify("extend", "forward", "character");
  }, { sel: selector, n: chars });
  await page.keyboard.press("Shift+ArrowRight");
  await settle(page, 250);
}

// ---------------------------------------------------------------- keyboard flow
section("Keyboard only: select, comment, reply, resolve, go to text");
{
  const page = await open();
  const panelHidden = await page.evaluate(() => {
    const p = document.querySelector(".cmt-panel");
    return { inert: p.hasAttribute("inert"), vis: getComputedStyle(p).visibility, expanded: document.querySelector(".cmt-toggle").getAttribute("aria-expanded") };
  });
  ok(panelHidden.inert && panelHidden.vis === "hidden" && panelHidden.expanded === "false", "closed panel is inert and hidden from Tab and screen readers", JSON.stringify(panelHidden));

  // Tab through the whole page: nothing inside the closed panel should ever take focus.
  const seen = new Set();
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  for (let i = 0; i < 6; i++) { await page.keyboard.press("Tab"); seen.add(await page.evaluate(() => document.activeElement.closest(".cmt-panel") ? "panel" : document.activeElement.className || document.activeElement.tagName)); }
  ok(!seen.has("panel"), "Tab never lands inside the closed panel");

  // Focus the link, select text with Shift+Arrow, ask for a comment with the shortcut.
  await page.focus("#lnk");
  await selectWithKeys(page, "#p1", 12);
  ok(/Alt\+Shift\+C/.test(await live(page)), "selecting with the keyboard announces the shortcut", await live(page));
  await page.keyboard.press("Alt+Shift+KeyC");
  await settle(page);
  const dlg = await page.evaluate(() => {
    const c = document.querySelector(".cmt-composer");
    return c ? { role: c.getAttribute("role"), label: c.getAttribute("aria-label"), focusInside: c.contains(document.activeElement), focus: document.activeElement.id } : null;
  });
  ok(dlg && dlg.role === "dialog" && dlg.label === "Add a note", "Alt+Shift+C opens the note box as a labelled dialog", JSON.stringify(dlg));
  ok(dlg && dlg.focusInside, "focus moves into the comment box", dlg && dlg.focus);

  // Tab order and trap: name -> comment -> Cancel -> Comment -> back to name.
  await page.keyboard.type("Sam");
  await page.keyboard.press("Tab");
  ok((await active(page)).id === "cmt-new", "Tab goes from name to comment");
  await page.keyboard.type("Reads clearly to me.");
  await page.keyboard.press("Tab"); await page.keyboard.press("Tab");
  ok((await active(page)).text === "Add note", "Tab reaches the Add note button");
  await page.keyboard.press("Tab");
  ok((await active(page)).id === "cmt-name", "Tab wraps inside the dialog (focus is trapped)");

  // Escape cancels and returns focus to where it was.
  await page.keyboard.press("Escape"); await settle(page);
  ok((await page.locator(".cmt-composer").count()) === 0, "Escape closes the comment box");
  ok((await active(page)).id === "lnk", "focus returns to the element that had it before", JSON.stringify(await active(page)));
  ok((await page.locator("mark.cmt-pending").count()) === 0, "Escape leaves no pending highlight behind");

  // Again, and post with the keyboard.
  await selectWithKeys(page, "#p1", 12);
  await page.keyboard.press("Alt+Shift+KeyC"); await settle(page);
  await page.keyboard.type("Sam");
  await page.keyboard.press("Tab");
  await page.keyboard.type("Reads clearly to me.");
  await page.keyboard.press("Tab"); await page.keyboard.press("Tab");
  await page.keyboard.press("Enter"); await settle(page, 500);
  ok(/Note added/.test(await live(page)), "posting announces “Note added”", await live(page));
  const after = await page.evaluate(() => {
    const a = document.activeElement, li = a.closest(".cmt-thread");
    const lab = li && document.getElementById(li.getAttribute("aria-labelledby"));
    return { inPanel: !!a.closest(".cmt-panel"), isThread: !!li, name: lab ? lab.textContent : null,
             panelOpen: document.querySelector(".cmt-panel").classList.contains("cmt-open"),
             tag: li ? li.tagName : null, list: document.querySelector(".cmt-list").tagName };
  });
  ok(after.panelOpen && after.inPanel && after.isThread, "the panel opens and focus lands on the new comment", JSON.stringify(after));
  ok(after.name && after.name.includes("Select text"), "the comment's accessible name is its quoted words", after.name);
  ok(after.tag === "LI" && after.list === "UL", "comments are a list");

  // Buttons name which comment they act on.
  const names = await page.evaluate(() => Array.from(document.querySelectorAll(".cmt-thread .cmt-actions button")).map((b) => b.getAttribute("aria-label")));
  ok(names.length === 3 && names.every((n) => /Select text|“/.test(n)), "Go to / Reply / Resolve each say which comment", JSON.stringify(names));

  // Reply with the keyboard.
  await page.locator(".cmt-thread .cmt-actions button", { hasText: "Reply" }).focus();
  await page.keyboard.press("Enter"); await settle(page);
  ok((await active(page)).tag === "TEXTAREA", "Reply puts focus in the reply box");
  await page.keyboard.type("Thanks, agreed.");
  await page.keyboard.press("Escape"); await settle(page);
  ok((await page.locator(".cmt-reply").count()) === 0 && (await page.locator(".cmt-panel.cmt-open").count()) === 1, "Escape closes the reply box first, not the panel");
  await page.locator(".cmt-thread .cmt-actions button", { hasText: "Reply" }).focus();
  await page.keyboard.press("Enter"); await settle(page);
  await page.keyboard.type("Thanks, agreed.");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter"); await settle(page, 500);
  ok(/Reply added/.test(await live(page)), "replying announces “Reply added”", await live(page));

  // Go to text: focus ends on the highlight.
  await page.locator(".cmt-thread .cmt-actions button", { hasText: "Go to text" }).focus();
  await page.keyboard.press("Enter"); await settle(page, 300);
  const goto = await page.evaluate(() => ({ tag: document.activeElement.tagName, text: document.activeElement.textContent.slice(0, 20) }));
  ok(goto.tag === "MARK" && /Select text/.test(goto.text), "Go to text moves focus to the highlighted words", JSON.stringify(goto));
  ok((await page.evaluate(() => document.activeElement.hasAttribute("tabindex"))) === true, "the highlight is focusable only while it has focus");

  // Resolve, and the state is visible as text.
  await page.keyboard.press("Tab"); // leave the mark
  await page.locator(".cmt-panel").evaluate((p) => p.focus());
  await page.evaluate(() => document.querySelector(".cmt-thread .cmt-actions button:last-child").focus());
  await page.keyboard.press("Enter"); await settle(page, 500);
  ok(/Thread resolved/.test(await live(page)), "resolving announces “Thread resolved”", await live(page));
  await page.locator("#cmt-showres").focus(); await page.keyboard.press("Space"); await settle(page, 300);
  const resolved = await page.evaluate(() => { const s = document.querySelector(".cmt-state"); return s ? s.textContent : null; });
  ok(resolved === "Resolved", "a resolved comment says so in words, not only by fading", resolved);

  // Escape closes the panel and focus goes back to the Comments button.
  await page.locator(".cmt-panel").evaluate((p) => p.focus());
  await page.keyboard.press("Escape"); await settle(page, 400);
  ok((await page.locator(".cmt-panel.cmt-open").count()) === 0, "Escape closes the panel");
  ok(await page.evaluate(() => document.activeElement.classList.contains("cmt-toggle") || document.activeElement.id === "lnk"), "focus goes back to where it came from");
  // The toggle announces the count when the panel opens.
  await page.locator(".cmt-toggle").focus(); await page.keyboard.press("Enter"); await settle(page, 300);
  ok(/1 note, 0 unresolved/.test(await live(page)), "opening the panel announces the counts", await live(page));
  ok((await page.evaluate(() => document.querySelector(".cmt-toggle").getAttribute("aria-expanded"))) === "true", "the Notes button reports aria-expanded");
  ok(page.errors.length === 0, "no page errors", page.errors.join("; "));
  await page.context().close();
}

section("Keyboard only: pin an image");
{
  const page = await open();
  await page.locator(".cmt-toggle").focus(); await page.keyboard.press("Enter"); await settle(page);
  await page.locator(".cmt-pinbtn").focus(); await page.keyboard.press("Enter"); await settle(page);
  ok((await page.locator("img#im[tabindex='0']").count()) === 1, "images become focusable while pinning");
  await page.focus("img#im");
  await page.keyboard.press("ArrowRight"); await page.keyboard.press("ArrowDown");
  await settle(page, 200);
  ok(/percent across/.test(await live(page)), "arrow keys announce the pin position", await live(page));
  await page.keyboard.press("Enter"); await settle(page);
  ok((await page.locator(".cmt-composer").count()) === 1, "Enter drops the pin and opens the comment box");
  ok((await page.locator("img#im[tabindex]").count()) === 0, "images stop being focusable afterwards");
  await page.keyboard.type("Sam"); await page.keyboard.press("Tab"); await page.keyboard.type("Move this up.");
  await page.keyboard.press("Tab"); await page.keyboard.press("Tab"); await page.keyboard.press("Enter"); await settle(page, 500);
  const pin = await page.evaluate(() => { const b = document.querySelector(".cmt-pin"); return b ? { tag: b.tagName, name: b.getAttribute("aria-label"), text: b.textContent } : null; });
  ok(pin && pin.tag === "BUTTON" && /Note 1 on Grey box/.test(pin.name), "the pin is a real button with a name", JSON.stringify(pin));
  await page.context().close();
}

// ---------------------------------------------------------------- contrast
section("Contrast (WCAG 2.2 AA): computed from what is on screen");
{
  const page = await open();
  // A comment, a pin, a resolved comment, a pending highlight, an error, the composer.
  await page.evaluate(() => {
    localStorage.setItem("comments:author", "Sam");
    localStorage.setItem("comments:fixture", JSON.stringify([
      { id: "aaaaaa111111", pageId: "fixture", quote: "Select text", prefix: "", suffix: " on any page", author: "Sam", text: "An open comment.", createdAt: 1, resolved: false, replies: [{ id: "r1", author: "Alex", text: "A reply.", createdAt: 2 }] },
      { id: "bbbbbb222222", pageId: "fixture", quote: "think twice", prefix: "", suffix: "", author: "Sam", text: "A resolved comment.", createdAt: 3, resolved: true, replies: [] },
      { id: "cccccc333333", pageId: "fixture", quote: "", prefix: "", suffix: "", pin: { src: "x", alt: "gone", i: 0, x: 0.2, y: 0.2 }, author: "Sam", text: "A lost pin.", createdAt: 4, resolved: false, replies: [] },
      { id: "dddddd444444", pageId: "fixture", quote: "nowhere to be found", prefix: "", suffix: "", author: "Sam", text: "Lost text.", createdAt: 5, resolved: false, replies: [] },
    ]));
  });
  await page.reload(); await page.waitForSelector(".cmt-toggle", { state: "attached" });
  await page.locator(".cmt-toggle").click(); await settle(page, 300);
  await page.locator("#cmt-showres").check(); await settle(page, 200);
  // open an error, a reply box with a missing name, and the composer
  await page.evaluate(() => { document.querySelector(".cmt-thread .cmt-actions button:nth-last-child(2)").click(); });
  await page.evaluate(() => {
    const box = document.querySelector(".cmt-thread");
    const e = document.createElement("div"); e.className = "cmt-error"; e.setAttribute("data-cmt", "ui"); e.setAttribute("role", "alert");
    e.innerHTML = '<span data-cmt="ui">Could not post your reply. </span><button class="cmt-link" data-cmt="ui" type="button">Retry</button>';
    box.appendChild(e);
  });
  const result = await page.evaluate(() => {
    const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(",").map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
    const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    const L = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
    const ratio = (a, b) => { const x = L(a), y = L(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    const blend = (top, bottom) => ({ r: top.r * top.a + bottom.r * (1 - top.a), g: top.g * top.a + bottom.g * (1 - top.a), b: top.b * top.a + bottom.b * (1 - top.a), a: 1 });
    const bgOf = (node) => {
      const stack = [];
      for (let n = node; n; n = n.parentElement) { const c = parse(getComputedStyle(n).backgroundColor); if (c && c.a > 0) { stack.push(c); if (c.a === 1) break; } }
      let out = { r: 255, g: 255, b: 255, a: 1 };
      for (let i = stack.length - 1; i >= 0; i--) out = blend(stack[i], out);
      return out;
    };
    const rows = [];
    const sel = ".cmt-toggle, .cmt-panel *, mark.cmt-hl, mark.cmt-pending, .cmt-pin, .cmt-composer *, .cmt-selbtn, .cmt-pinhint";
    document.querySelectorAll(sel).forEach((n) => {
      const cs = getComputedStyle(n);
      if (cs.visibility === "hidden" || cs.display === "none") return;
      const own = Array.from(n.childNodes).some((c) => c.nodeType === 3 && c.nodeValue.trim());
      if (!own) return;
      let fg = parse(cs.color); if (!fg) return;
      const bg = bgOf(n); fg = blend(fg, bg);
      // opacity of an ancestor lowers the effective contrast too
      let op = 1; for (let a = n; a; a = a.parentElement) op *= Number(getComputedStyle(a).opacity);
      if (op < 1) fg = blend({ ...fg, a: op }, bg);
      const size = parseFloat(cs.fontSize), bold = Number(cs.fontWeight) >= 700;
      const large = size >= 24 || (bold && size >= 18.66);
      rows.push({ el: (n.className || n.tagName) + ":" + (n.textContent || "").trim().slice(0, 24), ratio: Math.round(ratio(fg, bg) * 100) / 100, need: large ? 3 : 4.5 });
    });
    // non-text: the highlight underline and the pin ring against the page, and the focus ring colours
    const hex = (h) => ({ r: parseInt(h.slice(1, 3), 16), g: parseInt(h.slice(3, 5), 16), b: parseInt(h.slice(5, 7), 16), a: 1 });
    const mark = document.querySelector("mark.cmt-hl:not([data-resolved])");
    const nontext = [];
    if (mark) nontext.push({ el: "highlight underline vs page", ratio: Math.round(ratio(parse(getComputedStyle(mark).borderBottomColor), { r: 255, g: 255, b: 255, a: 1 }) * 100) / 100, need: 3 });
    nontext.push({ el: "focus ring ink vs white", ratio: Math.round(ratio(hex("#0b0c0c"), hex("#ffffff")) * 100) / 100, need: 3 });
    nontext.push({ el: "focus ring ink vs yellow", ratio: Math.round(ratio(hex("#0b0c0c"), hex("#ffc726")) * 100) / 100, need: 3 });
    const pin = document.querySelector(".cmt-pin");
    if (pin) nontext.push({ el: "pin ring vs page", ratio: Math.round(ratio(parse(getComputedStyle(pin).borderTopColor), { r: 255, g: 255, b: 255, a: 1 }) * 100) / 100, need: 3 });
    return { rows, nontext };
  });
  const bad = result.rows.filter((r) => r.ratio < r.need);
  ok(result.rows.length > 10, "sampled " + result.rows.length + " text elements");
  ok(bad.length === 0, "every sampled text pair meets AA", bad.map((b) => b.el + " " + b.ratio + "<" + b.need).join("; "));
  const min = result.rows.reduce((m, r) => (r.ratio < m.ratio ? r : m), result.rows[0]);
  console.log("        lowest text ratio: " + min.ratio + " (" + min.el + ")");
  result.nontext.forEach((r) => ok(r.ratio >= r.need, r.el + " " + r.ratio + ":1 (needs " + r.need + ")"));
  await page.context().close();
}

// ---------------------------------------------------------------- targets, motion, forced colours, zoom
section("Target size, reduced motion, forced colours, 200% zoom");
{
  const page = await open();
  await page.evaluate(() => localStorage.setItem("comments:author", "Sam"));
  await page.locator(".cmt-toggle").click(); await settle(page, 300);
  const small = await page.evaluate(() => Array.from(document.querySelectorAll(".cmt-panel button, .cmt-panel input[type=checkbox], .cmt-panel label")).filter((n) => n.getClientRects().length).map((n) => { const r = n.getBoundingClientRect(); return { n: (n.className || n.tagName) + ":" + (n.textContent || "").trim().slice(0, 18), w: Math.round(r.width), h: Math.round(r.height) }; }).filter((x) => x.w < 24 || x.h < 24));
  ok(small.length === 0, "desktop controls in the panel are at least 24 by 24 px", JSON.stringify(small));
  await page.context().close();

  const rm = await open({ viewport: { width: 1100, height: 800 }, reducedMotion: "reduce" });
  const motion = await rm.evaluate(() => {
    const p = document.querySelector(".cmt-panel"); const cs = getComputedStyle(p);
    return { dur: cs.transitionDuration };
  });
  ok(/^0s(, 0s)*$/.test(motion.dur), "reduced motion: the panel does not slide", motion.dur);
  await rm.context().close();

  const fc = await open({ viewport: { width: 1100, height: 800 }, forcedColors: "active" });
  await fc.evaluate(() => {
    localStorage.setItem("comments:fixture", JSON.stringify([{ id: "aaaaaa111111", pageId: "fixture", quote: "Select text", prefix: "", suffix: "", author: "Sam", text: "x", createdAt: 1, resolved: false, replies: [] },
      { id: "cccccc333333", pageId: "fixture", quote: "", pin: { src: "data:image/svg+xml;utf8," + "", alt: "", i: 0, x: 0.5, y: 0.5 }, author: "Sam", text: "p", createdAt: 2, resolved: false, replies: [] }]));
  });
  await fc.reload(); await fc.waitForSelector(".cmt-toggle", { state: "attached" });
  const forced = await fc.evaluate(() => {
    const m = document.querySelector("mark.cmt-hl"), t = document.querySelector(".cmt-toggle");
    return { markLine: m ? getComputedStyle(m).borderBottomWidth + " " + getComputedStyle(m).borderBottomStyle : null, toggleBorder: getComputedStyle(t).borderTopWidth + " " + getComputedStyle(t).borderTopStyle };
  });
  ok(forced.markLine && forced.markLine.startsWith("3px solid"), "forced colours: highlights keep a visible line", forced.markLine);
  ok(forced.toggleBorder === "2px solid", "forced colours: buttons keep their border", forced.toggleBorder);
  await fc.context().close();

  // 1280x720 at 200% zoom is 640x360 CSS pixels.
  const z = await open({ viewport: { width: 640, height: 360 } });
  await z.evaluate(() => localStorage.setItem("comments:author", "Sam"));
  await z.locator(".cmt-toggle").click(); await settle(z, 300);
  const zr = await z.evaluate(() => { const p = document.querySelector(".cmt-panel"); const r = p.getBoundingClientRect(); return { right: Math.round(r.right), left: Math.round(r.left), w: innerWidth, sw: p.scrollWidth, cw: p.clientWidth }; });
  ok(zr.right <= zr.w + 1 && zr.left >= -1 && zr.sw <= zr.cw + 1, "200% zoom: the panel fits without clipping or sideways scroll", JSON.stringify(zr));
  await z.keyboard.press("Escape");
  await selectWithKeys(z, "#p1", 10);
  await z.keyboard.press("Alt+Shift+KeyC"); await settle(z, 300);
  const cr = await z.evaluate(() => { const c = document.querySelector(".cmt-composer"); const r = c.getBoundingClientRect(); return { l: Math.round(r.left), r: Math.round(r.right), w: innerWidth }; });
  ok(cr.l >= -1 && cr.r <= cr.w + 1, "200% zoom: the comment box is on screen", JSON.stringify(cr));
  await z.context().close();
}

section("Phone: modal sheet and target sizes");
{
  const page = await open({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  await page.evaluate(() => localStorage.setItem("comments:author", "Sam"));
  await page.locator(".cmt-toggle").tap(); await settle(page, 400);
  const d = await page.evaluate(() => { const p = document.querySelector(".cmt-panel"); return { role: p.getAttribute("role"), modal: p.getAttribute("aria-modal") }; });
  ok(d.role === "dialog" && d.modal === "true", "on a phone the panel is a modal dialog", JSON.stringify(d));
  const small = await page.evaluate(() => Array.from(document.querySelectorAll(".cmt-panel button")).filter((n) => n.getClientRects().length).map((n) => { const r = n.getBoundingClientRect(); return { n: (n.className || "") + ":" + n.textContent.trim().slice(0, 14), w: Math.round(r.width), h: Math.round(r.height) }; }).filter((x) => x.h < 44 || x.w < 44));
  ok(small.length === 0, "phone controls in the panel are at least 44 by 44 px", JSON.stringify(small));
  // Tab is trapped: go round the panel and never leave it.
  let leaked = false;
  for (let i = 0; i < 8; i++) { await page.keyboard.press("Tab"); if (!(await page.evaluate(() => !!document.activeElement.closest(".cmt-panel")))) leaked = true; }
  ok(!leaked, "Tab stays inside the modal panel");
  await page.context().close();
}

// ---------------------------------------------------------------- wording
section("Wording: the default is note, and noun: \"comment\" gives the old words");
{
  const page = await open();
  const t = await page.evaluate(() => ({ toggle: document.querySelector(".cmt-toggle").textContent, title: document.querySelector("#cmt-title").textContent, sel: document.querySelector(".cmt-selpanel").textContent, list: document.querySelector(".cmt-list").getAttribute("aria-label"), close: document.querySelector(".cmt-close").getAttribute("aria-label") }));
  ok(t.toggle === "Notes" && t.title === "Notes", "default: the button and panel say Notes", JSON.stringify(t));
  ok(t.sel === "Add note on selection" && t.list === "Notes on this page" && t.close === "Close notes", "default: panel actions and labels say note", JSON.stringify(t));
  await page.context().close();

  await writeFile(join(dir, "noun.html"), FIXTURE.replace('{apiBase:null,pageId:"fixture"}', '{apiBase:null,pageId:"fixture-noun",noun:"comment"}'));
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 800 } });
  const p2 = await ctx.newPage();
  await p2.goto(pathToFileURL(join(dir, "noun.html")).href);
  await p2.waitForSelector(".cmt-toggle", { state: "attached" });
  const c = await p2.evaluate(() => ({ toggle: document.querySelector(".cmt-toggle").textContent, title: document.querySelector("#cmt-title").textContent, sel: document.querySelector(".cmt-selpanel").textContent, close: document.querySelector(".cmt-close").getAttribute("aria-label"), empty: document.querySelector(".cmt-empty").textContent }));
  ok(c.toggle === "Comments" && c.title === "Comments", "noun comment: the button and panel say Comments", JSON.stringify(c));
  ok(c.sel === "Add comment on selection" && c.close === "Close comments" && /^No comments yet/.test(c.empty), "noun comment: panel actions and empty state say comment", JSON.stringify(c));
  await selectWithKeys(p2, "#p1", 20);
  await p2.keyboard.press("Alt+Shift+C"); await settle(p2, 250);
  const label = await p2.evaluate(() => { const d = document.querySelector(".cmt-composer"); return d ? d.getAttribute("aria-label") : null; });
  ok(label === "Add a comment", "noun comment: the box is labelled Add a comment", String(label));
  await ctx.close();
}

// ---------------------------------------------------------------- axe-core (optional)
section("axe-core (optional)");
if (process.env.AXE_CORE) {
  const page = await open();
  await page.evaluate(() => localStorage.setItem("comments:author", "Sam"));
  await page.locator(".cmt-toggle").click(); await settle(page, 300);
  await page.addScriptTag({ content: await readFile(process.env.AXE_CORE, "utf8") });
  const res = await page.evaluate(async () => {
    const r = await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa", "best-practice"] } });
    return r.violations.filter((v) => v.nodes.some((n) => /cmt-|data-cmt/.test(n.html))).map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.filter((n) => /cmt-|data-cmt/.test(n.html)).length }));
  });
  ok(res.length === 0, "axe finds no violations in the widget's own markup", JSON.stringify(res));
  await page.context().close();
} else console.log("  skip  set AXE_CORE=/path/to/axe.min.js to run axe-core");

await browser.close();
console.log("\n" + (checks - failures) + " of " + checks + " checks passed" + (failures ? ", " + failures + " FAILED" : ""));
process.exit(failures ? 1 : 0);
