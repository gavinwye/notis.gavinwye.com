// Builds the interactive dashboard demo for the Notis site: /demo/dashboard/.
//
// It is the real dashboard page. The only difference is a small script placed before it that
// runs the real server code (server/core.mjs) inside the page, with invented notes in memory,
// and answers the dashboard's own requests with it. So everything on the page works (filters,
// search, resolve, reply, export) but nothing is sent anywhere, nothing is shared between
// visitors, and a reload starts again. The site has no server for strangers to write to.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { dashboardHtml } from "../server/dashboard.mjs";

const DASHBOARD_IMPORT = 'import { dashboardHtml } from "./dashboard.mjs";';

// Invented notes about an invented council site. Times are days or hours before the page loads.
const SEED = String.raw`
  var H = 3600000, D = 24 * H, now = Date.now();
  function note(id, pageId, title, quote, author, text, ago, extra) {
    var t = { id: id, pageId: pageId, title: title + " | Example council", url: "https://example.com" + pageId,
      quote: quote || "", prefix: "", suffix: "", author: author, text: text, createdAt: now - ago, resolved: false, replies: [] };
    for (var k in extra) t[k] = extra[k];
    return t;
  }
  var apply = "/permits/apply", applyT = "Apply for a parking permit";
  return [
    note("demoapply1", apply, applyT, "Start now", "Priya", "The button says Start now, but the next page is titled Check you can apply.", 20 * H,
      { replies: [{ id: "demor1", author: "Tom", text: "Agreed. I will match the page title.", createdAt: now - 6 * H }] }),
    note("demoapply2", apply, applyT, "proof of address", "Amira", "Say which documents count as proof of address. Reviewers keep asking.", 2 * H),
    note("demoapply3", apply, applyT, "", "Sam", "The pin sits on the wrong field since the redesign.", 4 * D,
      { resolved: true, pin: { src: "/permit-form.png", alt: "Permit form", i: 0, x: 0.4, y: 0.3 } }),
    note("demorenew1", "/permits/renew", "Renew a permit", "14 days before it expires", "Tom", "Is it 14 or 21 days? The FAQ says 21.", 3 * D),
    note("democontact1", "/contact", "Contact us", "", "Sam", "Add the opening hours for the phone line.", 5 * H),
    note("democontact2", "/contact", "Contact us", "info@example", "Priya", "The email address has a typo.", 8 * D, { resolved: true }),
    note("demohistory1", "/about/history", "Our history", "founded in 1987", "Tom", "Check the year with the archive team.", 14 * D)
  ];
`;

/** The script that stands in for the server. `coreSource` is server/core.mjs. */
export function demoPrelude(coreSource) {
  if (!coreSource.includes(DASHBOARD_IMPORT)) throw new Error("core.mjs has no dashboard import to replace");
  const core = coreSource
    .replace(DASHBOARD_IMPORT, () => "const dashboardHtml = () => '';")
    .replace(/^export /gm, "");
  if (/<\/script/i.test(core + SEED)) throw new Error("the demo script contains a closing script tag");
  return `<script>
(function () {
  "use strict";
${core}
  var seed = (function () {${SEED}})();
  var base = location.pathname.replace(/\\/dashboard\\/?$/, "");
  var storage = memoryStorage();
  var ready = Promise.all(seed.map(function (t) { return storage.put(t); }));
  var handle = createHandler({ storage: storage, config: { adminToken: "demo", dashboard: "public", basePath: base } });
  var realFetch = window.fetch.bind(window);
  // Only the dashboard's own requests (to this page's base path) are answered here.
  window.fetch = function (input, init) {
    var req = new Request(input, init);
    var path = new URL(req.url).pathname;
    if (path === base || path.indexOf(base + "/") === 0) return ready.then(function () { return handle(req); });
    return realFetch(input, init);
  };
})();
</script>`;
}

const FONTS = [
  ["Barlow Semi Condensed", 600, "barlow-semi-condensed-latin-600-normal"],
  ["Barlow Semi Condensed", 700, "barlow-semi-condensed-latin-700-normal"],
  ["Barlow", 400, "barlow-latin-400-normal"],
  ["Barlow", 500, "barlow-latin-500-normal"],
  ["Barlow", 600, "barlow-latin-600-normal"],
].map(([family, weight, file]) => `@font-face{font-family:'${family}';font-style:normal;font-weight:${weight};font-display:swap;src:url('/fonts/${file}.woff2') format('woff2')}`).join("\n");

const EXTRA_CSS = `${FONTS}
.logo{text-decoration:none}.logo:hover{background:none}
.demo-banner{background:var(--mark);border:1px solid var(--markline);padding:12px 16px;margin:24px 0 0;font-size:17px;line-height:1.45}`;

const BANNER = `<p class="demo-banner" role="note"><strong>This is a demo.</strong> The notes are invented and nothing leaves your browser. Filter, search, resolve, reply and export all work; reload to start again. “Open page” and “Go to note” go to example.com. <a href="/">Back to Notis</a>, or <a href="/#add-it-to-a-page">add it to your own site</a>.</p>`;

/** The whole demo page. */
export async function renderDashboardDemo(root) {
  const core = await readFile(join(root, "server", "core.mjs"), "utf8");
  let html = dashboardHtml("demo");
  const swap = (from, to) => {
    if (!html.includes(from)) throw new Error("the dashboard page changed: cannot find " + from.slice(0, 50));
    html = html.split(from).join(to);
  };
  swap("<title>Notis notes dashboard</title>", "<title>Notes dashboard demo — Notis</title>");
  swap('<meta name="robots" content="noindex">', '<meta name="robots" content="noindex"><link rel="icon" type="image/svg+xml" href="/favicon.svg">');
  swap('<span class="logo"><span class="sq"></span>Notis</span>', '<a class="logo" href="/"><span class="sq"></span>Notis</a>');
  swap("</style>\n</head>", `${EXTRA_CSS}\n</style>\n</head>`);
  swap('<div class="hero">', `${BANNER}\n<div class="hero">`);
  swap("Notes load from your own server.", "On your own site, this page loads notes from your own server.");
  // The demo's own script goes before the dashboard's, so fetch is replaced before the page asks for anything.
  swap('<script nonce="demo">\n(function () {\n  "use strict";\n  var base', `${demoPrelude(core)}\n<script nonce="demo">\n(function () {\n  "use strict";\n  var base`);
  return html;
}
