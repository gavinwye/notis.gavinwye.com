/* =====================================================================
   select-to-comment — a drop-in review widget
   ---------------------------------------------------------------------
   Add to any page, before </body>:

     <script src="/comments.js" defer></script>

   Reviewers select text on the page and leave threaded comments; a side
   panel lists every thread, with replies, resolve, and a "show resolved"
   toggle. Self-contained — injects its own CSS, no dependencies.

   ── Configuration ──────────────────────────────────────────────────
   Defaults work out of the box (shared storage via /api/comments, one
   thread list per URL path). Override either way:

   1. Global, before the script loads:
        <script>window.COMMENTS_CONFIG = { pageId: "my-page", root: "main" };</script>
        <script src="/comments.js" defer></script>

   2. Data attributes on the script tag:
        <script src="/comments.js" data-page-id="my-page" data-root="main" defer></script>

   Options:
     apiBase   base path of the comments API           (default "/api")
     pageId    thread namespace for this page           (default: URL path)
     root      CSS selector for the commentable region  (default "body")
     dock      true to dock the panel beside the page, pushing content
               over instead of covering it              (default false)
     pins      true to let reviewers drop a pin on an image   (default true)
     supabase  { url, anonKey } to use Supabase instead of the API
               (leave null to use apiBase; set apiBase null to fall back
               to browser-only localStorage)

   ── Events (dispatched on document) ────────────────────────────────
     comments:created   detail:{ thread }  a comment was posted
     comments:replied   detail:{ id }      a reply was posted
     comments:resolved  detail:{ id, resolved }  a thread was resolved or reopened
     comments:select  detail:{ el }  text was selected inside the root
     comments:focus   detail:{ el }  a thread's highlight was focused
     comments:close                  the panel was closed
   Pages can listen for these to add context, e.g. highlight a column.

   ── API contract (see netlify/functions/comments.mjs) ──────────────
     GET    {apiBase}/comments?page={pageId}        -> [thread, ...]
     POST   {apiBase}/comments             body:thread -> thread
     POST   {apiBase}/comments/{id}/replies body:reply -> reply
     PATCH  {apiBase}/comments/{id}         body:{resolved} -> thread

   A "thread": { id, pageId, quote, prefix, suffix, author, text,
                 createdAt, resolved, replies: [ {id, author, text, createdAt} ] }
   ===================================================================== */
(function () {
  "use strict";

  var VERSION = "0.2.0";
  window.NotisVersion = VERSION; // quote this when reporting a bug
  var script = document.currentScript;
  function dataAttr(name) { return script ? script.getAttribute(name) : null; }

  // Default page namespace: normalise the URL path so /foo/, /foo/index.html
  // and the prettified /foo all map to the same thread list.
  var defaultPath = location.pathname.replace(/\.html$/, "").replace(/\/index$/, "/");
  defaultPath = defaultPath.replace(/\/+$/, "") || "/";

  var COMMENTS_CONFIG = Object.assign({
    supabase: null,
    apiBase: "/api",
    pageId: defaultPath,
    root: "body",
    dock: false,
    pins: true
  }, window.COMMENTS_CONFIG || {});

  if (dataAttr("data-api-base") != null) COMMENTS_CONFIG.apiBase = dataAttr("data-api-base");
  if (dataAttr("data-page-id") != null) COMMENTS_CONFIG.pageId = dataAttr("data-page-id");
  if (dataAttr("data-root") != null) COMMENTS_CONFIG.root = dataAttr("data-root");
  if (dataAttr("data-pins") != null) COMMENTS_CONFIG.pins = dataAttr("data-pins") !== "false";
  if (dataAttr("data-dock") != null) COMMENTS_CONFIG.dock = dataAttr("data-dock") !== "false";

  /* ---------- storage adapters (async, Promise-based) ---------- */
  function LocalStore(pageId) {
    var key = "comments:" + pageId;
    function read() { try { return JSON.parse(localStorage.getItem(key)) || []; } catch (e) { return []; } }
    function write(a) { localStorage.setItem(key, JSON.stringify(a)); }
    return {
      list: function () { return Promise.resolve(read()); },
      create: function (thread) { var a = read(); a.push(thread); write(a); return Promise.resolve(thread); },
      reply: function (id, reply) {
        var a = read(), t = a.find(function (x) { return x.id === id; });
        if (t) { t.replies.push(reply); write(a); } return Promise.resolve(reply);
      },
      setResolved: function (id, resolved) {
        var a = read(), t = a.find(function (x) { return x.id === id; });
        if (t) { t.resolved = resolved; write(a); } return Promise.resolve(t);
      }
    };
  }
  function ApiStore(base, pageId) {
    function j(r) { if (!r.ok) throw new Error("API " + r.status); return r.json(); }
    return {
      list: function () { return fetch(base + "/comments?page=" + encodeURIComponent(pageId)).then(j); },
      create: function (thread) {
        return fetch(base + "/comments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(thread) }).then(j);
      },
      reply: function (id, reply) {
        return fetch(base + "/comments/" + id + "/replies", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(reply) }).then(j);
      },
      setResolved: function (id, resolved) {
        return fetch(base + "/comments/" + id, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resolved: resolved }) }).then(j);
      }
    };
  }
  function SupabaseStore(cfg, pageId) {
    var base = cfg.url.replace(/\/$/, "") + "/rest/v1";
    var h = { apikey: cfg.anonKey, Authorization: "Bearer " + cfg.anonKey, "Content-Type": "application/json" };
    function j(r) { if (!r.ok) return r.text().then(function (t) { throw new Error("Supabase " + r.status + ": " + t); }); return r.json(); }
    return {
      list: function () {
        return fetch(base + "/comments?pageId=eq." + encodeURIComponent(pageId) + "&order=createdAt.asc", { headers: h }).then(j);
      },
      create: function (thread) {
        return fetch(base + "/comments", { method: "POST", headers: Object.assign({ Prefer: "return=representation" }, h), body: JSON.stringify(thread) })
          .then(j).then(function (rows) { return rows[0]; });
      },
      reply: function (id, reply) {
        return fetch(base + "/comments?id=eq." + id + "&select=replies", { headers: h }).then(j).then(function (rows) {
          var reps = (rows[0] && rows[0].replies) || []; reps.push(reply);
          return fetch(base + "/comments?id=eq." + id, { method: "PATCH", headers: h, body: JSON.stringify({ replies: reps }) });
        }).then(function () { return reply; });
      },
      setResolved: function (id, resolved) {
        return fetch(base + "/comments?id=eq." + id, { method: "PATCH", headers: h, body: JSON.stringify({ resolved: resolved }) });
      }
    };
  }

  var store = (COMMENTS_CONFIG.supabase && COMMENTS_CONFIG.supabase.url)
    ? SupabaseStore(COMMENTS_CONFIG.supabase, COMMENTS_CONFIG.pageId)
    : COMMENTS_CONFIG.apiBase
      ? ApiStore(COMMENTS_CONFIG.apiBase, COMMENTS_CONFIG.pageId)
      : LocalStore(COMMENTS_CONFIG.pageId);

  /* ---------- helpers ---------- */
  var uid = function () { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); };
  function savedName() { try { return (localStorage.getItem("comments:author") || "").trim(); } catch (e) { return ""; } }
  function saveName(n) { try { localStorage.setItem("comments:author", n); } catch (e) { /* storage blocked */ } }
  function when(ts) {
    var d = new Date(ts), now = Date.now(), s = (now - ts) / 1000;
    if (s < 60) return "just now";
    if (s < 3600) return Math.floor(s / 60) + "m ago";
    if (s < 86400) return Math.floor(s / 3600) + "h ago";
    return d.toLocaleDateString();
  }
  // All user content is rendered via textContent (see msg()/renderPanel()),
  // never innerHTML — do not reintroduce an HTML-string escaper here.
  function cssId(id) { return window.CSS && CSS.escape ? CSS.escape(id) : String(id).replace(/["\\\]]/g, "\\$&"); }
  function emit(name, detail) {
    try { document.dispatchEvent(new CustomEvent(name, { detail: detail || {} })); } catch (e) { /* old browser — events are optional */ }
  }
  function remember(key, val) { try { localStorage.setItem(key, val); } catch (e) { /* storage blocked — not essential */ } }
  function recall(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }

  /* ---------- anchoring (W3C text-quote style) ---------- */
  function rootEl() { return document.querySelector(COMMENTS_CONFIG.root) || document.body; }
  function textNodes(root) {
    var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        if (!n.nodeValue || !n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        if (n.parentElement && n.parentElement.closest("[data-cmt]")) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var out = [], n; while ((n = w.nextNode())) out.push(n); return out;
  }
  function buildIndex(root) {
    var nodes = textNodes(root), full = "", map = [];
    nodes.forEach(function (node) { map.push({ node: node, start: full.length, end: full.length + node.nodeValue.length }); full += node.nodeValue; });
    return { full: full, map: map };
  }
  function locate(ix, thread) {
    var idx = -1;
    if (thread.prefix || thread.suffix) {
      var probe = thread.prefix + thread.quote + thread.suffix, p = ix.full.indexOf(probe);
      if (p >= 0) idx = p + thread.prefix.length;
    }
    if (idx < 0) idx = ix.full.indexOf(thread.quote);
    if (idx >= 0) return { start: idx, end: idx + thread.quote.length };
    return locateLoose(ix, thread.quote);
  }
  // A selection that crosses paragraphs or list items carries line breaks the
  // page's text does not, so compare with all whitespace left out and map the
  // match back to real positions.
  function locateLoose(ix, quote) {
    var want = String(quote).replace(/\s+/g, "");
    if (want.length < 2) return null;
    var flat = "", at = [], i, ch;
    for (i = 0; i < ix.full.length; i++) {
      ch = ix.full.charAt(i);
      if (/\s/.test(ch)) continue;
      flat += ch; at.push(i);
    }
    var f = flat.indexOf(want);
    if (f < 0) return null;
    return { start: at[f], end: at[f + want.length - 1] + 1 };
  }
  function highlightRange(ix, thread, start, end) {
    ix.map.forEach(function (seg) {
      if (seg.end <= start || seg.start >= end) return;
      var a = Math.max(start, seg.start) - seg.start, b = Math.min(end, seg.end) - seg.start;
      var r = document.createRange();
      try { r.setStart(seg.node, a); r.setEnd(seg.node, b); } catch (e) { return; }
      var m = document.createElement("mark");
      m.className = "cmt-hl"; m.setAttribute("data-cmt", "hl"); m.dataset.thread = thread.id;
      if (thread.resolved) m.dataset.resolved = "1";
      m.addEventListener("click", function (e) { e.stopPropagation(); openPanel(); focusThread(thread.id); });
      try { r.surroundContents(m); } catch (e) { /* spans block boundary — skip this segment */ }
    });
  }
  // Build the text index ONCE from the un-highlighted DOM, locate every thread
  // against that single snapshot, then apply highlights from the last match to
  // the first. Wrapping a later match in a <mark> can't then shift the offsets
  // of earlier ones (which was corrupting multi-comment pages).
  function applyHighlights() {
    var ix = buildIndex(rootEl());
    var located = [];
    found = {};
    threads.forEach(function (t) {
      if (t.pin) return; // pinned to an image; renderPins() places these
      var loc = locate(ix, t);
      if (loc) found[t.id] = true;
      if (t.resolved && !showResolved) return;
      if (loc) located.push({ thread: t, start: loc.start, end: loc.end });
    });
    located.sort(function (a, b) { return b.start - a.start; });
    located.forEach(function (item) { highlightRange(ix, item.thread, item.start, item.end); });
  }
  function clearHighlights() {
    document.querySelectorAll('mark.cmt-hl').forEach(function (m) {
      var p = m.parentNode; while (m.firstChild) p.insertBefore(m.firstChild, m); p.removeChild(m); p.normalize();
    });
  }


  /* ---------- pins on images ---------- */
  function rootImages() {
    return Array.prototype.filter.call(rootEl().querySelectorAll("img"), function (im) { return !im.closest("[data-cmt]"); });
  }
  function findImage(pin) {
    var imgs = rootImages(), same = imgs.filter(function (im) { return im.getAttribute("src") === pin.src; });
    if (imgs[pin.i] && imgs[pin.i].getAttribute("src") === pin.src) return imgs[pin.i];
    return same[0] || null;
  }
  function imageLabel(pin) {
    if (pin.alt) return pin.alt;
    var name = String(pin.src || "").split("?")[0].split("/").pop();
    return name || "image";
  }
  // Threads in the order they appear on the page: text by its highlight, pins
  // by their image (then top to bottom, left to right). Anything that can no
  // longer be placed goes last, oldest first.
  function anchorNode(t) {
    if (t.pin) return findImage(t.pin);
    return document.querySelector('mark.cmt-hl[data-thread="' + cssId(t.id) + '"]');
  }
  function byPosition(list) {
    var rows = list.map(function (t) { return { t: t, n: anchorNode(t) }; });
    rows.sort(function (a, b) {
      if (!a.n || !b.n) {
        if (a.n !== b.n) return a.n ? -1 : 1;
        return (a.t.createdAt || 0) - (b.t.createdAt || 0);
      }
      if (a.n === b.n) {
        var pa = a.t.pin || { x: 0, y: 0 }, pb = b.t.pin || { x: 0, y: 0 };
        return (pa.y - pb.y) || (pa.x - pb.x) || ((a.t.createdAt || 0) - (b.t.createdAt || 0));
      }
      return a.n.compareDocumentPosition(b.n) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });
    return rows.map(function (r) { return r.t; });
  }
  var pinEls = [];
  function renderPins() {
    pinEls.forEach(function (e) { e.remove(); }); pinEls = [];
    var pinned = byPosition(threads.filter(function (t) { return t.pin; }));
    pinned.forEach(function (t, n) {
      var img = findImage(t.pin);
      found[t.id] = !!img;
      t.pinNumber = n + 1;
      if (!img || (t.resolved && !showResolved)) return;
      var r = img.getBoundingClientRect();
      if (!r.width || !r.height) return;
      var b = el("button", "cmt-pin", String(n + 1));
      b.dataset.thread = t.id; if (t.resolved) b.setAttribute("data-resolved", "1");
      b.setAttribute("aria-label", "Comment " + (n + 1) + " on " + imageLabel(t.pin));
      b.style.left = (window.scrollX + r.left + t.pin.x * r.width) + "px";
      b.style.top = (window.scrollY + r.top + t.pin.y * r.height) + "px";
      b.addEventListener("click", function (e) { e.stopPropagation(); openPanel(); focusThread(t.id); });
      document.body.appendChild(b); pinEls.push(b);
    });
  }
  var pinMode = false, pinHint = null, pinBtn = null;
  function setPinMode(on) {
    pinMode = !!on;
    document.documentElement.classList.toggle("cmt-pinning", pinMode);
    if (pinBtn) { pinBtn.setAttribute("aria-pressed", pinMode ? "true" : "false"); pinBtn.classList.toggle("cmt-on", pinMode); }
    if (pinHint) { pinHint.remove(); pinHint = null; }
    if (pinMode) {
      removeSelBtn(); removeComposer();
      pinHint = el("div", "cmt-pinhint", rootImages().length
        ? "Click an image to drop a pin. Press Esc to cancel."
        : "There are no images on this page to pin to.");
      document.body.appendChild(pinHint);
    }
  }
  document.addEventListener("click", function (e) {
    if (!pinMode) return;
    var img = e.target && e.target.closest ? e.target.closest("img") : null;
    if (!img || img.closest("[data-cmt]") || !rootEl().contains(img)) return;
    e.preventDefault(); e.stopPropagation();
    var r = img.getBoundingClientRect();
    var x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    var y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    var pin = { src: img.getAttribute("src") || "", i: rootImages().indexOf(img), alt: img.getAttribute("alt") || "", x: x, y: y };
    setPinMode(false);
    openComposer({ quote: "", prefix: "", suffix: "", pin: pin }, { bottom: e.clientY, left: e.clientX });
  }, true);
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && pinMode) setPinMode(false); });
  window.addEventListener("resize", function () { renderPins(); });
  window.addEventListener("load", function () { renderPins(); });

  /* ---------- state ---------- */
  var threads = [], showResolved = false, found = {};

  function refresh() {
    return store.list().then(function (list) {
      threads = list || [];
      clearHighlights();
      applyHighlights();
      renderPins();
      renderPanel();
      updateCount();
    });
  }

  /* ---------- UI ---------- */
  var toggleBtn, panel, listEl, selBtn, composer, resolvedChk;

  function buildUI() {
    var css = document.createElement("style");
    css.textContent =
      '[data-cmt]{box-sizing:border-box;font-family:"Figtree",arial,sans-serif;line-height:1.45;font-style:normal;letter-spacing:normal}' +
      '.cmt-panel,.cmt-composer{color:#0b0c0c;color-scheme:light}.cmt-panel .cmt-body{color:#0b0c0c}.cmt-panel label{color:#505a5f}' +
      'mark.cmt-hl{font:inherit;color:#0b0c0c;background:#fff3c4;border-bottom:2px solid #ffc726;cursor:pointer;padding:0 1px}' +
      'mark.cmt-hl[data-resolved]{background:#eef0f2;border-bottom-color:#b1b4b6}' +
      'mark.cmt-hl.cmt-flash{animation:cmtFlash 1.2s ease}' +
      '@keyframes cmtFlash{0%,100%{background:#fff3c4}50%{background:#ffd94d}}' +
      '.cmt-toggle{position:fixed;right:16px;bottom:16px;z-index:9000;background:#ffc726;color:#0b0c0c;border:2px solid #0b0c0c;padding:10px 16px;font-size:15px;font-weight:700;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.25)}' +
      '.cmt-toggle:hover{background:#ffd94d}.cmt-toggle:focus-visible,.cmt-btn:focus-visible,.cmt-selbtn:focus-visible{outline:3px solid #0b0c0c;outline-offset:2px}' +
      '.cmt-panel{position:fixed;top:0;right:0;height:100vh;width:360px;max-width:92vw;background:#fff;border-left:2px solid #0b0c0c;box-shadow:-2px 0 12px rgba(0,0,0,.15);z-index:9001;transform:translateX(100%);transition:transform .2s;display:flex;flex-direction:column}' +
      '.cmt-panel.cmt-open{transform:none}' +
      // Docked: the page makes room for the panel instead of sitting under it.
      'html.cmt-docked body{margin-right:360px}' +
      'html.cmt-docked .cmt-panel{box-shadow:none}' +
      'html.cmt-docked .cmt-toggle{display:none}' +
      '@media (max-width:760px){html.cmt-docked body{margin-right:0}html.cmt-docked .cmt-panel{box-shadow:-2px 0 12px rgba(0,0,0,.15)}}' +
      '@media (prefers-reduced-motion:no-preference){body{transition:margin-right .2s}}' +
      '.cmt-head{display:flex;align-items:center;gap:8px;padding:14px 16px;border-bottom:2px solid #0b0c0c;background:#ffc726;color:#0b0c0c}' +
      '.cmt-head h2{margin:0;font-size:18px;flex:1}.cmt-head button{background:none;border:0;color:#0b0c0c;font-size:20px;cursor:pointer;line-height:1}' +
      '.cmt-sub{display:flex;align-items:center;gap:6px;padding:8px 16px;font-size:14px;color:#505a5f;border-bottom:1px solid #e0e4e9}' +
      '.cmt-list{flex:1;overflow:auto;padding:8px 0}' +
      '.cmt-empty{padding:24px 16px;color:#505a5f;font-size:15px}' +
      '.cmt-thread{padding:12px 16px;border-bottom:1px solid #e0e4e9;cursor:pointer}.cmt-thread[data-resolved] {opacity:.6}' +
      '.cmt-thread.cmt-active{background:#fffbea;box-shadow:inset 4px 0 0 #ffc726}' +
      '.cmt-quote{font-size:13px;color:#505a5f;border-left:3px solid #ffc726;padding-left:8px;margin-bottom:6px}' +
      '.cmt-lost{font-size:12px;color:#8a4b00;margin:-2px 0 6px}' +
      '.cmt-msg{margin:6px 0}.cmt-meta{font-size:12px;color:#505a5f}.cmt-body{font-size:15px;margin:2px 0;white-space:pre-wrap;word-wrap:break-word}' +
      '.cmt-actions{display:flex;gap:10px;margin-top:6px}' +
      '.cmt-actions button{background:none;border:0;color:#0b0c0c;font-size:13px;font-weight:700;cursor:pointer;padding:0;text-decoration:underline #ffc726 2px;text-underline-offset:3px}' +
      '.cmt-reply{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}.cmt-reply input{flex:1 1 100%;font:inherit;font-size:14px;border:0;background:#f3f2f1;color:#0b0c0c;padding:8px;outline:0}.cmt-reply input:focus{box-shadow:inset 0 -3px 0 #ffc726}.cmt-reply input.cmt-invalid{box-shadow:inset 0 -3px 0 #b3261e}.cmt-reply textarea{flex:1;font:inherit;font-size:14px;border:0;background:#f3f2f1;padding:8px;resize:vertical;min-height:34px;outline:0}.cmt-reply textarea:focus{box-shadow:inset 0 -3px 0 #ffc726}' +
      '.cmt-btn{background:#ffc726;color:#0b0c0c;border:2px solid #0b0c0c;padding:6px 12px;font-size:14px;font-weight:700;cursor:pointer}.cmt-btn:hover{background:#ffd94d}' +
      '.cmt-selbtn{position:absolute;z-index:9002;background:#ffc726;color:#0b0c0c;border:2px solid #0b0c0c;padding:6px 12px;font-size:14px;font-weight:700;cursor:pointer;box-shadow:0 2px 6px rgba(0,0,0,.3)}' +
      '.cmt-composer{position:absolute;z-index:9003;background:#fff;border:2px solid #0b0c0c;box-shadow:0 4px 16px rgba(0,0,0,.2);padding:10px;width:280px}' +
      '.cmt-composer textarea{width:100%;font:inherit;font-size:14px;border:0;background:#f3f2f1;color:#0b0c0c;padding:8px;resize:vertical;min-height:72px;box-sizing:border-box;outline:0}.cmt-composer textarea:focus{box-shadow:inset 0 -3px 0 #ffc726}.cmt-composer input{width:100%;font:inherit;font-size:14px;border:0;background:#f3f2f1;color:#0b0c0c;padding:8px;margin:0 0 10px;box-sizing:border-box;outline:0}.cmt-composer input:focus{box-shadow:inset 0 -3px 0 #ffc726}.cmt-composer input.cmt-invalid{box-shadow:inset 0 -3px 0 #b3261e}.cmt-composer .cmt-label{display:block;font-size:14px;font-weight:700;color:#0b0c0c;margin:0 0 6px}' +
      '.cmt-composer .cmt-row{display:flex;justify-content:flex-end;gap:8px;margin-top:8px}' +
      '.cmt-pin{position:absolute;z-index:9002;width:28px;height:28px;margin:-14px 0 0 -14px;padding:0;border-radius:50%;background:#ffc726;color:#0b0c0c;border:2px solid #0b0c0c;font:700 14px/1 "Figtree",arial,sans-serif;cursor:pointer;box-shadow:0 2px 6px rgba(0,0,0,.35)}' +
      '.cmt-pin:hover{background:#ffd94d}.cmt-pin:focus-visible{outline:3px solid #0b0c0c;outline-offset:2px}.cmt-pin[data-resolved]{background:#eef0f2}' +
      '.cmt-pin.cmt-flash{animation:cmtPin 1.2s ease}@keyframes cmtPin{0%,100%{transform:scale(1)}50%{transform:scale(1.5)}}' +
      'html.cmt-pinning img{cursor:crosshair !important;outline:3px dashed #ffc726;outline-offset:3px}' +
      '.cmt-pinhint{position:fixed;left:50%;top:16px;transform:translateX(-50%);z-index:9004;background:#0b0c0c;color:#fff;padding:10px 16px;font-size:15px;font-weight:600}' +
      '.cmt-head .cmt-pinbtn{background:#0b0c0c;color:#fff;border:0;padding:6px 10px;font-size:13px;font-weight:700;cursor:pointer}.cmt-head .cmt-pinbtn.cmt-on{background:#fff;color:#0b0c0c;box-shadow:inset 0 0 0 2px #0b0c0c}' +
      '.cmt-selbar{position:fixed;left:12px;right:12px;bottom:12px;z-index:9004;background:#ffc726;color:#0b0c0c;border:2px solid #0b0c0c;padding:14px 16px;font:700 17px/1.2 "Figtree",arial,sans-serif;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.35)}' +
      '.cmt-selbar:active{background:#ffd94d}' +
      'html.cmt-selecting .cmt-toggle{display:none}' +
      '.cmt-composer.cmt-sheet{position:fixed;top:auto;left:0;right:0;bottom:0;width:auto;max-height:85vh;overflow:auto;border-width:2px 0 0;padding:14px 16px 18px;box-shadow:0 -4px 16px rgba(0,0,0,.25);z-index:9005}' +
      '.cmt-composer.cmt-sheet input,.cmt-composer.cmt-sheet textarea{font-size:16px}' +
      '.cmt-composer.cmt-sheet .cmt-btn{padding:10px 18px;font-size:16px}.cmt-composer.cmt-sheet .cmt-cancel{padding:10px 12px;font-size:16px}' +
      '.cmt-composer .cmt-cancel{background:none;border:0;color:#505a5f;font-weight:700;cursor:pointer}';
    document.head.appendChild(css);

    toggleBtn = el('button', 'cmt-toggle', 'Comments');
    toggleBtn.setAttribute('data-cmt', 'toggle');
    toggleBtn.addEventListener('click', function () { panel.classList.contains('cmt-open') ? closePanel() : openPanel(); });
    document.body.appendChild(toggleBtn);

    panel = el('aside', 'cmt-panel'); panel.setAttribute('data-cmt', 'panel'); panel.setAttribute('aria-label', 'Comments');
    var head = el('div', 'cmt-head');
    var h2 = el('h2', '', 'Comments'); var close = el('button', '', '×'); close.setAttribute('aria-label', 'Close comments');
    close.addEventListener('click', closePanel); head.appendChild(h2);
    if (COMMENTS_CONFIG.pins) {
      pinBtn = el('button', 'cmt-pinbtn', 'Pin on image'); pinBtn.setAttribute('aria-pressed', 'false');
      pinBtn.addEventListener('click', function () { setPinMode(!pinMode); });
      head.appendChild(pinBtn);
    }
    head.appendChild(close);
    var sub = el('div', 'cmt-sub');
    resolvedChk = el('input'); resolvedChk.type = 'checkbox'; resolvedChk.id = 'cmt-showres';
    resolvedChk.addEventListener('change', function () { showResolved = resolvedChk.checked; refresh(); });
    var lbl = el('label', '', 'Show resolved'); lbl.setAttribute('for', 'cmt-showres');
    sub.appendChild(resolvedChk); sub.appendChild(lbl);
    listEl = el('div', 'cmt-list');
    panel.appendChild(head); panel.appendChild(sub); panel.appendChild(listEl);
    document.body.appendChild(panel);

    document.addEventListener('mouseup', function () { mouseIsDown = false; scheduleSelect(1); });
    document.addEventListener('keyup', function () { scheduleSelect(1); });
    // A long-press on a phone fires neither of those, only selectionchange.
    // While a mouse button is held the selection is still being dragged, so wait.
    document.addEventListener('mousedown', function () { mouseIsDown = true; }, true);
    document.addEventListener('selectionchange', function () { if (!mouseIsDown) scheduleSelect(150); });
  }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; e.setAttribute && e.setAttribute('data-cmt', e.getAttribute('data-cmt') || 'ui'); return e; }

  function openPanel() {
    panel.classList.add('cmt-open');
    if (COMMENTS_CONFIG.dock) { document.documentElement.classList.add('cmt-docked'); remember('comments:open', '1'); }
  }
  function closePanel() {
    panel.classList.remove('cmt-open');
    if (COMMENTS_CONFIG.dock) { document.documentElement.classList.remove('cmt-docked'); remember('comments:open', '0'); }
    emit('comments:close');
  }
  function updateCount() {
    var n = threads.filter(function (t) { return !t.resolved; }).length;
    toggleBtn.textContent = 'Comments' + (n ? ' (' + n + ')' : '');
  }

  function renderPanel() {
    listEl.innerHTML = '';
    var visible = byPosition(threads.filter(function (t) { return showResolved || !t.resolved; }));
    if (!visible.length) {
      listEl.appendChild(el('div', 'cmt-empty', (isTouch() ? 'No comments yet. Press and hold a word, drag to extend, then tap Comment.' : 'No comments yet. Select any text on the page to start one.') + (COMMENTS_CONFIG.pins ? ' You can also pin one to an image.' : '')));
      return;
    }
    visible.forEach(function (t) {
      var box = el('div', 'cmt-thread'); box.dataset.thread = t.id; if (t.resolved) box.setAttribute('data-resolved', '1');
      var q = t.pin
        ? el('div', 'cmt-quote', 'Pin ' + (t.pinNumber || '') + ' on ' + imageLabel(t.pin))
        : el('div', 'cmt-quote', '“' + t.quote + '”');
      box.appendChild(q);
      if (!found[t.id]) box.appendChild(el('div', 'cmt-lost', t.pin ? 'This image is no longer on the page.' : 'This text has changed since the comment was left.'));
      box.appendChild(msg(t.author, t.text, t.createdAt));
      (t.replies || []).forEach(function (r) { box.appendChild(msg(r.author, r.text, r.createdAt)); });
      var actions = el('div', 'cmt-actions');
      var reBtn = el('button', '', 'Reply'); reBtn.addEventListener('click', function (e) { e.stopPropagation(); showReply(box, t.id); });
      var resBtn = el('button', '', t.resolved ? 'Reopen' : 'Resolve');
      resBtn.addEventListener('click', function (e) { e.stopPropagation(); store.setResolved(t.id, !t.resolved).then(function () { emit('comments:resolved', { id: t.id, resolved: !t.resolved }); return refresh(); }); });
      actions.appendChild(reBtn); actions.appendChild(resBtn); box.appendChild(actions);
      box.addEventListener('click', function () { markActive(t.id); flash(t.id); });
      listEl.appendChild(box);
    });
  }
  function msg(author, text, ts) {
    var wrap = el('div', 'cmt-msg');
    wrap.appendChild(el('div', 'cmt-meta', author + ' · ' + when(ts)));
    wrap.appendChild(el('div', 'cmt-body', text));
    return wrap;
  }
  function showReply(box, id) {
    if (box.querySelector('.cmt-reply')) return;
    var wrap = el('div', 'cmt-reply'); var ta = el('textarea'); var send = el('button', 'cmt-btn', 'Post'); ta.id = 'cmt-reply-' + id; ta.setAttribute('aria-label', 'Your reply');
    ta.addEventListener('click', function (e) { e.stopPropagation(); });
    send.addEventListener('click', function (e) {
      e.stopPropagation();
      var v = ta.value.trim();
      var who = nameIn ? nameIn.value.trim() : savedName();
      if (!who) { nameIn.focus(); nameIn.classList.add('cmt-invalid'); return; }
      if (!v) { ta.focus(); return; }
      saveName(who);
      store.reply(id, { id: uid(), author: who, text: v, createdAt: Date.now() }).then(function () { emit('comments:replied', { id: id }); return refresh(); });
    });
    // Anyone who has not given a name yet is asked for it first, above the reply.
    var nameIn = null;
    if (!savedName()) {
      nameIn = el('input'); nameIn.type = 'text'; nameIn.maxLength = 80; nameIn.autocomplete = 'name';
      nameIn.setAttribute('aria-label', 'Your name'); nameIn.placeholder = 'Your name';
      nameIn.addEventListener('click', function (e) { e.stopPropagation(); });
      wrap.appendChild(nameIn);
    }
    wrap.appendChild(ta); wrap.appendChild(send); box.appendChild(wrap); (nameIn || ta).focus();
  }
  function markActive(id) {
    listEl.querySelectorAll('.cmt-thread.cmt-active').forEach(function (b) { b.classList.remove('cmt-active'); });
    var box = listEl.querySelector('.cmt-thread[data-thread="' + cssId(id) + '"]');
    if (box) box.classList.add('cmt-active');
    return box;
  }
  function focusThread(id) {
    var box = markActive(id);
    if (box) box.scrollIntoView({ block: 'center' });
    flash(id);
  }
  function flash(id) {
    var pe = document.querySelector('.cmt-pin[data-thread="' + cssId(id) + '"]');
    if (pe) {
      pe.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
      pe.classList.add('cmt-flash'); setTimeout(function () { pe.classList.remove('cmt-flash'); }, 1200);
      emit('comments:focus', { el: pe });
      return;
    }
    var m = document.querySelector('mark.cmt-hl[data-thread="' + cssId(id) + '"]');
    if (m) {
      m.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
      m.classList.add('cmt-flash'); setTimeout(function () { m.classList.remove('cmt-flash'); }, 1200);
      emit('comments:focus', { el: m });
    }
  }

  /* ---------- selection -> new comment ---------- */
  var selTimer = null, barBusy = false, mouseIsDown = false;
  function isTouch() { try { return window.matchMedia('(pointer: coarse)').matches; } catch (e) { return false; } }
  function scheduleSelect(delay) { clearTimeout(selTimer); selTimer = setTimeout(onSelect, delay); }
  function onSelect() {
    if (barBusy) return;   // someone is pressing the Comment bar; the tap can clear the selection first on iOS
    if (composer) return;  // a comment is being written; leave it alone
    removeSelBtn();
    var sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return;
    var range = sel.getRangeAt(0);
    if (!rootEl().contains(range.commonAncestorContainer)) return;
    if (range.startContainer.parentElement && range.startContainer.parentElement.closest('[data-cmt]')) return;
    var quote = sel.toString().trim();
    if (quote.length < 2) return;
    emit('comments:select', { el: range.startContainer.parentElement });
    var rect = range.getBoundingClientRect();
    var saved = { quote: quote, prefix: ctx(range, -32, 'start'), suffix: ctx(range, 32, 'end') };
    var touch = isTouch();
    selBtn = el('button', touch ? 'cmt-selbar' : 'cmt-selbtn', touch ? 'Comment on selection' : 'Comment');
    if (!touch) {
      selBtn.style.top = (window.scrollY + rect.bottom + 6) + 'px';
      selBtn.style.left = (window.scrollX + rect.left) + 'px';
    } else {
      // The phone's own Copy / Share menu sits next to the selection, so the
      // button goes at the bottom of the screen, and the toggle gets out of the way.
      document.documentElement.classList.add('cmt-selecting');
    }
    var btn = selBtn, opened = false;
    function open(e) {
      e.stopPropagation();
      if (e.cancelable) e.preventDefault();
      if (opened) return;
      opened = true; barBusy = false;
      openComposer(saved, rect);
    }
    btn.addEventListener('mousedown', function (e) { e.preventDefault(); });
    btn.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      barBusy = true;
      setTimeout(function () { barBusy = false; }, 1500); // never stay stuck if the press is cancelled
    });
    btn.addEventListener('pointercancel', function () { barBusy = false; });
    // Open on click, not pointerup: the sheet appears under the finger, and a
    // click that follows pointerup would land on its Cancel button.
    btn.addEventListener('click', open);
    document.body.appendChild(btn);
  }
  function ctx(range, n, which) {
    try {
      var ix = buildIndex(rootEl());
      var node = which === 'start' ? range.startContainer : range.endContainer;
      var off = which === 'start' ? range.startOffset : range.endOffset;
      var seg = ix.map.find(function (s) { return s.node === node; });
      var g = seg ? seg.start + off : ix.full.indexOf(range.toString());
      if (g < 0) return '';
      return n < 0 ? ix.full.slice(Math.max(0, g + n), g) : ix.full.slice(g, g + n);
    } catch (e) { return ''; }
  }
  function removeSelBtn() {
    if (selBtn) { selBtn.remove(); selBtn = null; }
    document.documentElement.classList.remove('cmt-selecting');
  }
  function removeComposer() {
    if (composer) { composer.remove(); composer = null; }
    if (vvHandler && window.visualViewport) {
      window.visualViewport.removeEventListener('resize', vvHandler);
      window.visualViewport.removeEventListener('scroll', vvHandler);
    }
    vvHandler = null;
  }
  var vvHandler = null;

  function openComposer(saved, rect) {
    removeSelBtn(); removeComposer();
    composer = el('div', 'cmt-composer');
    if (isTouch()) {
      composer.classList.add('cmt-sheet');
      composer.setAttribute('role', 'dialog'); composer.setAttribute('aria-label', 'Add a comment');
      var vv = window.visualViewport, sheet = composer;
      // Keep the sheet above the on-screen keyboard.
      vvHandler = function () {
        if (!vv || !sheet.isConnected) return;
        sheet.style.bottom = Math.max(0, window.innerHeight - vv.height - vv.offsetTop) + 'px';
      };
      if (vv) { vv.addEventListener('resize', vvHandler); vv.addEventListener('scroll', vvHandler); }
    } else {
      composer.style.top = (window.scrollY + rect.bottom + 6) + 'px';
      composer.style.left = (window.scrollX + Math.min(rect.left, document.documentElement.clientWidth - 300)) + 'px';
    }
    var nameIn = el('input'); nameIn.type = 'text'; nameIn.id = 'cmt-name'; nameIn.maxLength = 80; nameIn.autocomplete = 'name';
    nameIn.value = savedName();
    var nameLab = el('label', 'cmt-label', 'Your name'); nameLab.setAttribute('for', 'cmt-name');
    var ta = el('textarea'); ta.id = 'cmt-new';
    var lab = el('label', 'cmt-label', 'Your comment'); lab.setAttribute('for', 'cmt-new');
    var row = el('div', 'cmt-row');
    var cancel = el('button', 'cmt-cancel', 'Cancel'); cancel.addEventListener('click', removeComposer);
    var post = el('button', 'cmt-btn', 'Comment');
    post.addEventListener('click', function () {
      var v = ta.value.trim();
      var who = nameIn.value.trim();
      if (!who) { nameIn.focus(); nameIn.classList.add('cmt-invalid'); return; }
      if (!v) { ta.focus(); return; }
      saveName(who);
      var thread = {
        id: uid(), pageId: COMMENTS_CONFIG.pageId, quote: saved.quote,
        prefix: saved.prefix, suffix: saved.suffix, pin: saved.pin || undefined, author: who,
        text: v, createdAt: Date.now(), resolved: false, replies: []
      };
      store.create(thread).then(function (created) {
        emit('comments:created', { thread: created || thread });
        removeComposer(); window.getSelection().removeAllRanges();
        return refresh().then(function () { openPanel(); if (created && created.id) markActive(created.id); });
      });
    });
    row.appendChild(cancel); row.appendChild(post);
    composer.appendChild(nameLab); composer.appendChild(nameIn); composer.appendChild(lab); composer.appendChild(ta); composer.appendChild(row);
    document.body.appendChild(composer); (nameIn.value ? ta : nameIn).focus();
    if (vvHandler) vvHandler();
  }
  document.addEventListener('mousedown', function (e) {
    if (composer && !composer.contains(e.target)) removeComposer();
    if (selBtn && e.target !== selBtn) removeSelBtn();
  });

  /* ---------- go ---------- */
  function init() {
    buildUI();
    if (COMMENTS_CONFIG.dock && recall('comments:open') === '1') openPanel();
    refresh();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
