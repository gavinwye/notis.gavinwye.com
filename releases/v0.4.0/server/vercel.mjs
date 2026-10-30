// Notis on Vercel. Threads live in a private Vercel Blob store, one JSON blob
// per thread under `notis/t/<id>.json`.
//
// Connect a private Blob store to the project so Vercel sets BLOB_READ_WRITE_TOKEN.
// Copy this file to api/comments.js (or route every /api/comments* request to it).
import { get, list, put, del } from "@vercel/blob";
// ---- Notis core (from server/core.mjs) ----
// The Notis API, with no host in it. It takes a Request and gives back a
// Response, and keeps threads through a small storage object, so the same code
// runs on Netlify, Cloudflare Workers or plain Node. Each host has a short
// adapter that supplies `storage` and the settings.
//
//   GET    {base}?page=<pageId>      -> [thread, ...]   (all threads if no page)
//   GET    {base}?summary=1          -> [{pageId,title,url,open,resolved,latest,openAt}, ...]  (no note text)
//   GET    {base}/dashboard          -> the notes dashboard (an HTML page; the data calls are gated)
//   POST   {base}                    body:{pageId[,title,url],quote,prefix,suffix,author,text[,pin]} -> thread
//   POST   {base}/:id/replies        body:{author,text} -> reply
//   PATCH  {base}/:id                body:{resolved} -> thread
//   DELETE {base}/:id                moderation: remove one   (admin token)
//   DELETE {base}                    moderation: remove all   (admin token)
//
// storage: {
//   list():   Promise<thread[]>
//   get(id):  Promise<thread | null>
//   put(t):   Promise<void>          create or replace one thread
//   remove(id): Promise<boolean>     true if it existed
//   clear():  Promise<void>
// }
// config: { adminToken, allowedOrigins: string[], basePath: "/api/comments", dashboard: "public" | "" }
//   dashboard "public" lets anyone read the per-page summary; otherwise it needs the admin token.
// ---- Notis dashboard page (from server/dashboard.mjs) ----
// The Notis notes dashboard: one HTML page with its own style and script, no libraries and no
// third-party requests. It holds no data; it asks the API (same address, minus "/dashboard") for a
// summary and for each page's notes. Note text only ever goes in with textContent, never as HTML.
// core.mjs serves it with a Content-Security-Policy that allows only this page's nonce.
//
// Written without backticks or dollar-brace sequences in the page, so String.raw keeps it as typed.

const PAGE = String.raw`<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="robots" content="noindex">
<title>Notis notes dashboard</title>
<style nonce="__NONCE__">
:root{--ink:#0b0c0c;--muted:#4b5559;--line:#d8dde0;--paper:#fff;--tint:#f6f7f8;--mark:#fff3c4;--markline:#ffc726;--link:#1d5fa3;--err:#b3261e}
@media (prefers-color-scheme:dark){:root{--ink:#f1f3f4;--muted:#aab3b7;--line:#2f373b;--paper:#111517;--tint:#181d20;--mark:#4a3d0c;--link:#7db4ec;--err:#ff8a80}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;font-family:var(--notis-font,"Barlow","Barlow Fallback",system-ui,sans-serif);font-size:19px;line-height:1.55;color:var(--ink);background:var(--paper)}
h1,h2,.logo,.num{font-family:"Barlow Semi Condensed","Barlow",system-ui,sans-serif}
button,input,textarea{font:inherit;color:inherit}
a,.linkbtn{color:var(--ink);text-decoration:underline;text-decoration-color:var(--markline);text-decoration-thickness:2px;text-underline-offset:3px}
a:hover,.linkbtn:hover{background:var(--mark)}
.linkbtn{background:none;border:0;padding:0;cursor:pointer;font-weight:600}
.linkbtn[disabled]{color:var(--muted);cursor:default;background:none}
:focus-visible{outline:3px solid var(--ink);outline-offset:2px}
[hidden]{display:none!important}
.vh{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.wrap{max-width:920px;margin:0 auto;padding:0 20px}
.top{border-bottom:1px solid var(--line);padding:16px 0}
.bar{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:8px 16px}
.logo{font-weight:700;font-size:24px;letter-spacing:-.01em;display:flex;align-items:center;gap:10px}
.sq{width:24px;height:24px;background:#ffc726;display:inline-block}
.host{font-size:16px;color:var(--muted)}
main{padding-bottom:80px}
.hero{padding:56px 0 32px}
h1{margin:0 0 20px;font-size:clamp(36px,6vw,56px);line-height:1.18;font-weight:700;text-wrap:balance;isolation:isolate}
h1 mark{position:relative;z-index:-1;background:var(--mark);color:inherit;border-bottom:3px solid var(--markline);padding:0 .08em}
.lede{margin:0;font-size:24px;font-weight:600;color:var(--ink);max-width:34em;overflow-wrap:anywhere}
.totals{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:20px;margin-bottom:36px}
.total{background:var(--tint);border:1px solid var(--line);padding:16px 18px}
.num{font-weight:700;font-size:34px;line-height:1.1}
.lab{font-size:17px;color:var(--muted)}
.controls{display:flex;flex-wrap:wrap;align-items:center;gap:12px 24px;padding-bottom:20px}
.tabs{display:flex;gap:20px}
.tab{background:none;border:0;padding:0;min-height:44px;font-size:18px;font-weight:600;color:var(--muted);cursor:pointer}
.tab[aria-pressed="true"]{color:var(--ink);text-decoration:underline;text-decoration-color:var(--markline);text-decoration-thickness:2px;text-underline-offset:6px}
.search{flex:1 1 240px;display:flex;gap:8px}
.search .grow{flex:1;display:flex;min-width:0}
.search input{flex:1;min-width:0;min-height:44px;padding:0 12px;font-size:18px;border:1px solid var(--line);border-radius:0;background:var(--paper)}
.btn{font-weight:600;font-size:17px;background:#ffc726;color:#0b0c0c;border:2px solid #0b0c0c;border-radius:0;padding:8px 14px;min-height:44px;cursor:pointer}
.btn[disabled]{opacity:.6;cursor:default}
.note-status{min-height:1.55em;margin:0 0 12px;font-size:16px;color:var(--muted)}
section.group{margin-top:14px;padding:14px 0 8px;border-top:2px solid var(--ink)}
section.group h2{margin:0;font-size:30px;line-height:1.1;font-weight:700;letter-spacing:-.01em}
.grouphead{display:flex;align-items:baseline;gap:12px;margin-bottom:8px}
.count{font-size:17px;color:var(--muted)}
.page{border-bottom:1px solid var(--line)}
.page:last-child{border-bottom:0}
.new{font-weight:700;color:var(--ink)}
.row{display:flex;flex-wrap:wrap;align-items:center;gap:8px 16px;padding:8px 0}
.badge{width:30px;height:30px;display:inline-flex;align-items:center;justify-content:center;background:var(--ink);color:var(--paper);font-weight:700;font-size:16px;flex:none}
.name{flex:1 1 260px;display:flex;flex-direction:column;align-items:flex-start;min-height:44px;padding:0;background:none;border:0;text-align:left;cursor:pointer;color:var(--ink);font-size:19px;justify-content:center}
.pn{font-weight:600}
.pp{font-size:16px;color:var(--muted);overflow-wrap:anywhere}
.row a,.row .linkbtn{font-size:17px;font-weight:600;display:inline-flex;align-items:center;min-height:44px}
.notes{list-style:none;margin:0 0 16px;padding:0;border:1px solid var(--line);border-bottom:0}
.notes li{padding:14px 16px;border-bottom:1px solid var(--line);display:flex;flex-direction:column;gap:4px}
.target{font-size:16px;color:var(--muted);border-left:2px solid var(--markline);padding-left:10px;overflow-wrap:anywhere}
.meta{font-size:14px;color:var(--muted)}
.text{font-size:19px;overflow-wrap:anywhere;white-space:pre-wrap}
.replies{list-style:none;margin:4px 0 0;padding:0 0 0 12px;border-left:1px solid var(--line);display:flex;flex-direction:column;gap:2px;font-size:16px}
.replies li{border:0;padding:0}
.replies .by{font-weight:600}
.acts{display:flex;flex-wrap:wrap;align-items:center;gap:0 16px;padding-top:4px}
.acts a,.acts .linkbtn{font-size:15px;font-weight:600;min-height:44px;display:inline-flex;align-items:center}
.err{font-size:15px;color:var(--err)}
.reply{display:flex;flex-direction:column;gap:8px;padding-top:8px;max-width:520px}
.reply label{font-size:15px;font-weight:600}
.reply input,.reply textarea{border:1px solid var(--line);border-radius:0;background:var(--paper);padding:8px 12px;font-size:17px;width:100%}
.reply textarea{min-height:88px}
.reply .btns{display:flex;gap:16px;align-items:center}
.gate{max-width:520px;display:flex;flex-direction:column;gap:12px;padding:0 0 32px}
.gate h2{margin:0;font-size:30px;font-weight:700}
.gate input{min-height:44px;padding:0 12px;font-size:18px;border:1px solid var(--line);border-radius:0;background:var(--paper)}
.gate p{margin:0}
.empty{padding:24px 0;color:var(--muted)}
.foot{margin:32px 0 0;font-size:15px;color:var(--muted);border-top:1px solid var(--line);padding-top:20px}
.foot p{margin:0 0 8px}
.foot .linkbtn{font-size:17px;min-height:44px}
@media (max-width:560px){.hero{padding:32px 0 24px}.lede{font-size:19px}.tabs{width:100%}}
@media (prefers-reduced-motion:no-preference){a,.linkbtn{transition:background-color .1s}}
</style>
</head>
<body>
<header class="top"><div class="wrap bar"><span class="logo"><span class="sq"></span>Notis</span><span class="host" id="host"></span></div></header>
<main class="wrap">
<div class="hero">
<h1>Every note, <mark>on every page</mark>.</h1>
<p class="lede" id="site"></p>
</div>

<form class="gate" id="gate" hidden>
<h2>Enter the admin token to see all notes</h2>
<label for="token">Admin token</label>
<input id="token" type="password" autocomplete="off" spellcheck="false">
<p class="err" id="gate-err" role="alert" hidden></p>
<div><button class="btn" type="submit">See notes</button></div>
</form>

<div id="app" hidden>
<div class="totals">
<div class="total"><div class="num" id="t-open">0</div><div class="lab">Open notes</div></div>
<div class="total"><div class="num" id="t-pages">0</div><div class="lab">Pages with notes</div></div>
<div class="total"><div class="num" id="t-resolved">0</div><div class="lab">Resolved</div></div>
</div>
<div class="controls">
<div class="tabs" role="group" aria-label="Show">
<button class="tab" type="button" data-filter="open" aria-pressed="true">Open</button>
<button class="tab" type="button" data-filter="all" aria-pressed="false">All</button>
<button class="tab" type="button" data-filter="resolved" aria-pressed="false">Resolved</button>
</div>
<form class="search" id="searchform" role="search"><label class="grow"><span class="vh">Search notes, names or pages</span><input type="search" id="q" placeholder="Search notes, names or pages" autocomplete="off"></label><button class="btn" type="submit">Search</button></form>
</div>
<p class="note-status" id="progress"></p>
<div id="list"></div>
</div>

<p id="loading" class="empty">Loading notes</p>
<div class="foot">
<p id="exportrow" hidden><button class="linkbtn" type="button" id="export">Export as Markdown</button></p>
<p id="foot">Notes load from your own server.</p>
<p>Made with <a href="https://notis.gavinwye.com" rel="noopener">Notis</a></p>
</div>
</main>
<div class="vh" role="status" aria-live="polite" id="live"></div>
<script nonce="__NONCE__">
(function () {
  "use strict";
  var base = location.pathname.replace(/\/dashboard\/?$/, "");
  var KEY = "notis:dashboard-token";
  var SEEN = "notis:dashboard-seen";
  var state = { prevSeen: {}, seen: readSeen(), rows: [], notes: {}, loadingKey: {}, failed: {}, open: {}, replying: {}, busy: {}, err: {}, filter: "open", query: "", allLoaded: false, allLoading: false };
  var $ = function (id) { return document.getElementById(id); };

  function h(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function say(text) { var l = $("live"); l.textContent = ""; setTimeout(function () { l.textContent = text; }, 60); }
  function token() { try { return sessionStorage.getItem(KEY) || ""; } catch (e) { return ""; } }
  function setToken(v) { try { if (v) sessionStorage.setItem(KEY, v); else sessionStorage.removeItem(KEY); } catch (e) { /* blocked */ } }
  function savedName() { try { return (localStorage.getItem("comments:author") || "").trim(); } catch (e) { return ""; } }
  function saveName(n) { try { localStorage.setItem("comments:author", n); } catch (e) { /* blocked */ } }
  function plural(n, w) { return n + " " + w + (n === 1 ? "" : "s"); }

  function readSeen() { try { return JSON.parse(localStorage.getItem(SEEN)) || {}; } catch (e) { return {}; } }
  // A note is new to this browser when it was left after the last time this page was opened here.
  // Compared with the server's own clock (row.latest), so the two clocks never need to agree.
  function unread(row) {
    var seen = state.seen[row.pageId] || 0;
    return (row.openAt || []).filter(function (t) { return t > seen; }).length;
  }
  function markSeen(row) {
    if (!(row.pageId in state.prevSeen)) state.prevSeen[row.pageId] = state.seen[row.pageId] || 0;
    state.seen[row.pageId] = row.latest;
    try { localStorage.setItem(SEEN, JSON.stringify(state.seen)); } catch (e) { /* blocked */ }
  }
  // The site's name: what most page titles end with after " | ", else the host.
  function siteName() {
    var counts = {}, best = "", top = 0;
    state.rows.forEach(function (r) {
      var parts = String(r.title || "").split(/\s[|\u2013\u2014-]\s/);
      if (parts.length < 2) return;
      var name = parts[parts.length - 1].trim();
      if (!name) return;
      counts[name] = (counts[name] || 0) + 1;
      if (counts[name] > top) { top = counts[name]; best = name; }
    });
    return best || location.host;
  }

  function api(path, method, body) {
    var headers = {};
    var t = token();
    if (t) headers.Authorization = "Bearer " + t;
    if (body) headers["Content-Type"] = "application/json";
    return fetch(path, { method: method || "GET", headers: headers, body: body ? JSON.stringify(body) : undefined, cache: "no-store" }).then(function (r) {
      if (!r.ok) { var e = new Error("HTTP " + r.status); e.status = r.status; throw e; }
      return r.json();
    });
  }

  function when(ts) {
    var s = (Date.now() - ts) / 1000;
    if (s < 60) return "just now";
    if (s < 3600) return Math.floor(s / 60) + " min ago";
    if (s < 86400) return plural(Math.floor(s / 3600), "hour") + " ago";
    var d = Math.floor(s / 86400);
    if (d === 1) return "yesterday";
    if (d < 14) return d + " days ago";
    if (d < 60) return Math.floor(d / 7) + " weeks ago";
    return new Date(ts).toLocaleDateString();
  }

  /* ---------- turning a summary row into a section, a name and a path ---------- */
  function titleCase(seg) {
    var s = seg;
    try { s = decodeURIComponent(seg); } catch (e) { /* keep as is */ }
    s = s.replace(/\.html$/, "").replace(/[-_]+/g, " ").trim();
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  function pathOf(row) {
    var u = row.url || (row.pageId.charAt(0) === "/" ? row.pageId : "");
    if (!u) return "";
    if (/^https?:\/\//i.test(u)) { try { u = new URL(u).pathname; } catch (e) { return ""; } }
    u = u.split("#")[0].split("?")[0];
    return u.length > 1 ? u.replace(/\/+$/, "") : u;
  }
  function describe(row) {
    var path = pathOf(row);
    var segs = path.split("/").filter(Boolean);
    var section = !path ? "Other" : segs.length ? titleCase(segs[0]) : "Home";
    var name = row.title || (segs.length ? titleCase(segs[segs.length - 1]) : path ? "Home page" : row.pageId);
    return { section: section, name: name, path: path || row.pageId };
  }
  // The address to open: the stored url with the Notis switch on, optionally pointing at one note.
  function link(row, noteId) {
    // Older notes stored no address; by default the page id is the path, so it can stand in.
    var u = row.url || row.pageId;
    if (!u || !/^(\/(?![\/\\])|https?:\/\/)/i.test(u)) return "";
    u = u.split("#")[0];
    if (!/[?&]notis=1(&|$)/.test(u)) u += (u.indexOf("?") === -1 ? "?" : "&") + "notis=1";
    return noteId ? u + "#notis-" + noteId : u;
  }

  /* ---------- counts ---------- */
  function counts(row) {
    var list = state.notes[row.pageId];
    if (!list) return { open: row.open, resolved: row.resolved };
    var open = 0;
    list.forEach(function (n) { if (!n.resolved) open += 1; });
    return { open: open, resolved: list.length - open };
  }
  function shown(c) { return state.filter === "open" ? c.open : state.filter === "resolved" ? c.resolved : c.open + c.resolved; }
  function keep(n) { return state.filter === "all" || (state.filter === "open" ? !n.resolved : n.resolved); }
  function noteMatches(n, q) {
    var hay = [n.text, n.author, n.quote].concat((n.replies || []).map(function (r) { return r.text + " " + r.author; })).join(" ").toLowerCase();
    return hay.indexOf(q) !== -1;
  }
  function rowMatches(row, d, q) {
    if (!q) return true;
    if ((d.name + " " + d.path + " " + row.pageId).toLowerCase().indexOf(q) !== -1) return true;
    var list = state.notes[row.pageId];
    return !!list && list.some(function (n) { return keep(n) && noteMatches(n, q); });
  }

  /* ---------- loading ---------- */
  function loadNotes(row) {
    var id = row.pageId;
    if (state.notes[id] || state.loadingKey[id]) return Promise.resolve();
    state.loadingKey[id] = true; delete state.failed[id];
    return api(base + "?page=" + encodeURIComponent(id)).then(function (list) {
      state.notes[id] = list;
    }, function () {
      state.failed[id] = true;
    }).then(function () { delete state.loadingKey[id]; });
  }
  function loadAll() {
    if (state.allLoaded || state.allLoading) return Promise.resolve();
    var todo = state.rows.filter(function (r) { return !state.notes[r.pageId]; });
    if (!todo.length) { state.allLoaded = true; return Promise.resolve(); }
    state.allLoading = true;
    var done = 0, next = 0;
    function status() { $("progress").textContent = done < todo.length ? "Loading notes from " + plural(todo.length - done, "page") : ""; }
    status();
    function worker() {
      if (next >= todo.length) return Promise.resolve();
      var row = todo[next++];
      return loadNotes(row).then(function () { done += 1; status(); render(); return worker(); });
    }
    var pool = [];
    for (var i = 0; i < 6; i++) pool.push(worker());
    return Promise.all(pool).then(function () {
      state.allLoading = false;
      state.allLoaded = state.rows.every(function (r) { return state.notes[r.pageId]; });
      $("progress").textContent = state.allLoaded ? "" : "Some pages could not be loaded.";
      render();
    });
  }

  /* ---------- drawing ---------- */
  function noteTarget(n) {
    if (n.pin) return "Image: " + (n.pin.alt || n.pin.src || "");
    var q = String(n.quote || "").replace(/\s+/g, " ").trim();
    return q ? "\u201c" + (q.length > 90 ? q.slice(0, 90) + "\u2026" : q) + "\u201d" : "General";
  }
  function noteItem(row, n) {
    var li = h("li");
    li.appendChild(h("div", "target", noteTarget(n)));
    var isNew = row.pageId in state.prevSeen && n.createdAt > state.prevSeen[row.pageId];
    var meta = (isNew ? "New \u00b7 " : "") + n.author + " \u00b7 " + when(n.createdAt) + (n.replies && n.replies.length ? " \u00b7 " + n.replies.length + (n.replies.length === 1 ? " reply" : " replies") : "");
    li.appendChild(h("div", "meta", meta));
    li.appendChild(h("div", "text", n.text));
    if (n.replies && n.replies.length) {
      var rl = h("ul", "replies");
      n.replies.forEach(function (r) {
        var ri = h("li");
        ri.appendChild(h("span", "by", r.author + ": "));
        ri.appendChild(document.createTextNode(r.text));
        rl.appendChild(ri);
      });
      li.appendChild(rl);
    }
    var acts = h("div", "acts");
    var go = link(row, n.id);
    if (go) { var a = h("a", "", "Go to note"); a.href = go; a.setAttribute("aria-label", "Go to note by " + n.author); acts.appendChild(a); }
    var rb = h("button", "linkbtn", "Reply"); rb.type = "button"; rb.setAttribute("data-k", "r:" + n.id);
    rb.setAttribute("aria-expanded", state.replying[n.id] ? "true" : "false");
    rb.addEventListener("click", function () { state.replying[n.id] = !state.replying[n.id]; render("r:" + n.id); });
    acts.appendChild(rb);
    var busy = !!state.busy[n.id];
    var sb = h("button", "linkbtn", busy ? "Saving" : state.err[n.id] ? "Retry" : n.resolved ? "Reopen" : "Resolve");
    sb.type = "button"; sb.disabled = busy; sb.setAttribute("data-k", "s:" + n.id);
    sb.addEventListener("click", function () { toggleResolved(row, n); });
    acts.appendChild(sb);
    if (state.err[n.id] && !state.replying[n.id]) acts.appendChild(h("span", "err", state.err[n.id]));
    li.appendChild(acts);
    if (state.replying[n.id]) li.appendChild(replyForm(row, n));
    return li;
  }
  function replyForm(row, n) {
    var f = h("form", "reply");
    var nl = h("label", "", "Your name"); nl.setAttribute("for", "rn-" + n.id);
    var ni = h("input"); ni.id = "rn-" + n.id; ni.type = "text"; ni.maxLength = 80; ni.autocomplete = "name"; ni.value = state.replying[n.id + ":name"] != null ? state.replying[n.id + ":name"] : savedName();
    var tl = h("label", "", "Your reply"); tl.setAttribute("for", "rt-" + n.id);
    var ti = h("textarea"); ti.id = "rt-" + n.id; ti.maxLength = 4000; ti.value = state.replying[n.id + ":text"] || "";
    var err = h("p", "err"); err.setAttribute("role", "alert"); err.hidden = !state.err[n.id]; err.textContent = state.err[n.id] || "";
    var btns = h("div", "btns");
    var send = h("button", "btn", "Send reply"); send.type = "submit";
    var cancel = h("button", "linkbtn", "Cancel"); cancel.type = "button";
    cancel.addEventListener("click", function () { state.replying[n.id] = false; delete state.err[n.id]; render("r:" + n.id); });
    btns.appendChild(send); btns.appendChild(cancel);
    ni.addEventListener("input", function () { state.replying[n.id + ":name"] = ni.value; });
    ti.addEventListener("input", function () { state.replying[n.id + ":text"] = ti.value; });
    f.appendChild(nl); f.appendChild(ni); f.appendChild(tl); f.appendChild(ti); f.appendChild(err); f.appendChild(btns);
    f.addEventListener("submit", function (e) {
      e.preventDefault();
      var who = ni.value.trim(), text = ti.value.trim();
      if (!who) { ni.focus(); return; }
      if (!text) { ti.focus(); return; }
      saveName(who);
      send.disabled = true; send.textContent = "Sending";
      api(base + "/" + encodeURIComponent(n.id) + "/replies", "POST", { author: who, text: text }).then(function (reply) {
        (n.replies = n.replies || []).push(reply);
        state.replying[n.id] = false; delete state.replying[n.id + ":text"]; delete state.err[n.id];
        say("Reply sent");
        render("r:" + n.id);
      }, function () {
        state.err[n.id] = "Could not send the reply. Try again.";
        render("t:" + n.id);
      });
    });
    return f;
  }
  function toggleResolved(row, n) {
    var next = !n.resolved;
    state.busy[n.id] = true; delete state.err[n.id];
    render("s:" + n.id);
    api(base + "/" + encodeURIComponent(n.id), "PATCH", { resolved: next }).then(function (t) {
      n.resolved = t.resolved;
      delete state.busy[n.id];
      say(next ? "Note resolved" : "Note reopened");
      render("s:" + n.id, "n:" + row.pageId);
    }, function () {
      delete state.busy[n.id];
      state.err[n.id] = "Could not save. Try again.";
      render("s:" + n.id);
    });
  }
  function pageBlock(row, d) {
    var c = counts(row), id = row.pageId, expanded = !!state.open[id];
    var box = h("div", "page");
    var r = h("div", "row");
    var badge = h("span", "badge", String(shown(c))); badge.setAttribute("aria-hidden", "true");
    var nm = h("button", "name"); nm.type = "button"; nm.setAttribute("data-k", "n:" + id);
    nm.setAttribute("aria-expanded", expanded ? "true" : "false"); nm.setAttribute("aria-controls", "notes-" + id.replace(/[^a-z0-9]/gi, "_"));
    nm.appendChild(h("span", "pn", d.name));
    var pp = h("span", "pp", d.path + " \u00b7 " + c.open + " open, " + c.resolved + " resolved");
    var fresh = unread(row);
    if (fresh) { pp.appendChild(document.createTextNode(", ")); pp.appendChild(h("span", "new", fresh + " new")); }
    nm.appendChild(pp);
    var tb = h("button", "linkbtn", expanded ? "Hide notes" : "Show notes"); tb.type = "button"; tb.setAttribute("data-k", "b:" + id);
    tb.setAttribute("aria-label", (expanded ? "Hide notes on " : "Show notes on ") + d.name);
    var toggle = function (k) { return function () { state.open[id] = !state.open[id]; if (state.open[id]) markSeen(row); if (state.open[id]) loadNotes(row).then(function () { render(); }); render(k); }; };
    nm.addEventListener("click", toggle("n:" + id));
    tb.addEventListener("click", toggle("b:" + id));
    r.appendChild(badge); r.appendChild(nm);
    var go = link(row);
    if (go) { var a = h("a", "", "Open page"); a.href = go; a.setAttribute("aria-label", "Open " + d.name); r.appendChild(a); }
    r.appendChild(tb);
    box.appendChild(r);
    if (expanded) {
      var area = h("div"); area.id = "notes-" + id.replace(/[^a-z0-9]/gi, "_");
      if (state.failed[id]) {
        var p = h("p", "err", "Could not load these notes. ");
        var retry = h("button", "linkbtn", "Retry"); retry.type = "button";
        retry.addEventListener("click", function () { loadNotes(row).then(function () { render(); }); render(); });
        p.appendChild(retry); area.appendChild(p);
      } else if (!state.notes[id]) {
        area.appendChild(h("p", "empty", "Loading notes"));
      } else {
        var q = state.query, nameHit = (d.name + " " + d.path).toLowerCase().indexOf(q) !== -1;
        var list = state.notes[id].filter(function (n) { return keep(n) && (!q || nameHit || noteMatches(n, q)); })
          .sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
        if (!list.length) area.appendChild(h("p", "empty", "No notes to show."));
        else { var ul = h("ul", "notes"); list.forEach(function (n) { ul.appendChild(noteItem(row, n)); }); area.appendChild(ul); }
      }
      box.appendChild(area);
    }
    return box;
  }

  function render(focusKey, fallbackKey) {
    var active = document.activeElement, key = focusKey || (active && active.getAttribute && active.getAttribute("data-k"));
    var open = 0, resolved = 0;
    state.rows.forEach(function (r) { var c = counts(r); open += c.open; resolved += c.resolved; });
    $("t-open").textContent = open; $("t-pages").textContent = state.rows.length; $("t-resolved").textContent = resolved;

    var q = state.query, groups = {};
    state.rows.forEach(function (row) {
      var d = describe(row), c = counts(row);
      if (!shown(c) || !rowMatches(row, d, q)) return;
      (groups[d.section] = groups[d.section] || []).push({ row: row, d: d, c: c });
    });
    var names = Object.keys(groups).sort(function (a, b) { return a === "Other" ? 1 : b === "Other" ? -1 : a.localeCompare(b); });
    var list = $("list");
    list.textContent = "";
    if (!names.length) list.appendChild(h("p", "empty", state.rows.length ? (q ? "Nothing matches that search." : "No " + (state.filter === "all" ? "" : state.filter + " ") + "notes.") : "There are no notes yet."));
    names.forEach(function (name) {
      var items = groups[name].sort(function (a, b) { return a.d.path < b.d.path ? -1 : a.d.path > b.d.path ? 1 : 0; });
      var total = items.reduce(function (s, it) { return s + shown(it.c); }, 0);
      var sec = h("section", "group");
      var head = h("div", "grouphead");
      head.appendChild(h("h2", "", name));
      head.appendChild(h("span", "count", plural(total, "note")));
      sec.appendChild(head);
      items.forEach(function (it) { sec.appendChild(pageBlock(it.row, it.d)); });
      list.appendChild(sec);
    });
    if (key) {
      var target = document.querySelector('[data-k="' + key.replace(/["\\]/g, "\\$&") + '"]');
      if (!target && fallbackKey) target = document.querySelector('[data-k="' + fallbackKey.replace(/["\\]/g, "\\$&") + '"]');
      if (target && !target.disabled) target.focus();
    }
  }

  /* ---------- export ---------- */
  function markdown() {
    var out = ["# Notes on " + location.host, ""];
    var rows = state.rows.map(function (r) { return { row: r, d: describe(r) }; })
      .sort(function (a, b) { return a.d.path < b.d.path ? -1 : a.d.path > b.d.path ? 1 : 0; });
    var n = 0;
    rows.forEach(function (it) {
      var notes = (state.notes[it.row.pageId] || []).filter(keep).sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0); });
      if (!notes.length) return;
      out.push("## " + it.d.name, "", it.d.path, "");
      notes.forEach(function (t, i) {
        n += 1;
        out.push("### " + (i + 1) + ". " + noteTarget(t));
        if (t.quote) out.push("", "> " + String(t.quote).replace(/\n/g, "\n> "));
        out.push("", "**" + t.author + "**: " + t.text);
        (t.replies || []).forEach(function (r) { out.push("", "- **" + r.author + "**: " + r.text); });
        if (t.resolved) out.push("", "_Resolved_");
        out.push("");
      });
    });
    return { text: out.join("\n"), count: n };
  }
  function download(text) {
    var blob = new Blob([text], { type: "text/markdown" });
    var u = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = u; a.download = "notis-notes.md";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(u); }, 0);
  }
  function exportMd() {
    var b = $("export"); b.disabled = true; b.textContent = "Preparing";
    loadAll().then(function () {
      var m = markdown(), label = state.filter === "all" ? "" : state.filter + " ";
      var done = function () { say("Copied " + plural(m.count, label + "note") + " as Markdown"); };
      var fallback = function () { download(m.text); say("Downloaded " + plural(m.count, label + "note") + " as Markdown"); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(m.text).then(done, fallback); else fallback();
    }).then(function () { b.disabled = false; b.textContent = "Export as Markdown"; });
  }

  /* ---------- start ---------- */
  function showGate(wrong) {
    $("loading").hidden = true; $("app").hidden = true; $("gate").hidden = false;
    var e = $("gate-err"); e.hidden = !wrong; e.textContent = wrong ? "That token was not accepted." : "";
    $("exportrow").hidden = true;
    $("foot").textContent = "Only people with the admin token can see this page. The token stays in this tab and is not sent anywhere else.";
    $("token").focus();
  }
  function load() {
    $("loading").hidden = false; $("loading").textContent = "Loading notes";
    api(base + "?summary=1").then(function (rows) {
      state.rows = rows;
      $("gate").hidden = true; $("loading").hidden = true; $("app").hidden = false;
      $("foot").textContent = "Notes load from your own server.";
      $("exportrow").hidden = false;
      $("site").textContent = siteName();
      $("host").hidden = siteName() === location.host;
      render();
    }, function (err) {
      if (err.status === 403) { var had = !!token(); setToken(""); showGate(had); return; }
      $("loading").textContent = "Could not load notes. ";
      var b = h("button", "linkbtn", "Retry"); b.type = "button"; b.addEventListener("click", load);
      $("loading").appendChild(b);
    });
  }

  $("host").textContent = location.host;
  $("site").textContent = location.host;
  $("gate").addEventListener("submit", function (e) {
    e.preventDefault();
    var v = $("token").value.trim();
    if (!v) { $("token").focus(); return; }
    setToken(v); $("token").value = ""; load();
  });
  Array.prototype.forEach.call(document.querySelectorAll(".tab"), function (b) {
    b.addEventListener("click", function () {
      state.filter = b.getAttribute("data-filter");
      Array.prototype.forEach.call(document.querySelectorAll(".tab"), function (x) { x.setAttribute("aria-pressed", x === b ? "true" : "false"); });
      render();
    });
  });
  // Searching happens when the Search button (or Enter) is used. Emptying the box shows everything again.
  function search() {
    state.query = $("q").value.trim().toLowerCase();
    if (state.query) loadAll();
    render();
  }
  $("searchform").addEventListener("submit", function (e) { e.preventDefault(); search(); });
  $("q").addEventListener("input", function () { if (!$("q").value.trim() && state.query) search(); });
  $("export").addEventListener("click", exportMd);
  load();
})();
</script>
</body>
</html>
`;

function dashboardHtml(nonce) {
  return PAGE.replaceAll("__NONCE__", nonce);
}

// ---- end of dashboard page ----

// Field size caps keep stored data and rendering bounded.
const LIMITS = { src: 500, alt: 200, pageId: 200, title: 200, url: 500, quote: 800, prefix: 200, suffix: 200, author: 80, text: 4000, replies: 1000 };
const MAX_BODY = 64 * 1024; // bytes, checked before JSON.parse
const ID = /^[a-z0-9]{6,40}$/;

const clip = (v, max) => (v == null ? "" : String(v)).slice(0, max);
// Keep a page address only if it is a path on the same site or a web address. Anything else
// (javascript:, data:, a protocol-relative //host) is dropped, because the dashboard links to it.
const safeUrl = (v) => {
  const u = clip(v, LIMITS.url).trim();
  return /^(\/(?![\/\\])|https?:\/\/)/i.test(u) ? u : "";
};
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// One row per page: counts and the newest title and address, never any note text.
function summarise(threads) {
  const pages = new Map();
  for (const t of [...threads].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))) {
    const row = pages.get(t.pageId) || { pageId: t.pageId, title: "", url: "", open: 0, resolved: 0, latest: 0, openAt: [] };
    if (t.resolved) row.resolved += 1; else { row.open += 1; row.openAt.push(Number(t.createdAt) || 0); }
    if (t.title) row.title = t.title;
    if (t.url) row.url = t.url;
    row.latest = Math.max(row.latest, Number(t.createdAt) || 0, ...(t.replies || []).map((r) => Number(r.createdAt) || 0));
    pages.set(t.pageId, row);
  }
  return [...pages.values()].sort((a, b) => b.latest - a.latest);
}

function createHandler({ storage, config = {} }) {
  const adminToken = config.adminToken || "";
  const allowed = (config.allowedOrigins || []).map((s) => s.trim()).filter(Boolean);
  const basePath = (config.basePath || "/api/comments").replace(/\/+$/, "");
  const positiveInt = (value, fallback) => {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
  };
  const maxThreadsPerPage = positiveInt(config.maxThreadsPerPage, 500);
  const maxRepliesPerThread = positiveInt(config.maxRepliesPerThread, LIMITS.replies);
  // 0 turns the duplicate check off; anything else that isn't a positive whole number keeps the default.
  const duplicateWindowMs = String(config.duplicateWindowMs).trim() === "0" ? 0 : positiveInt(config.duplicateWindowMs, 60_000);
  const publicDashboard = String(config.dashboard || "").trim().toLowerCase() === "public";
  const threadWrites = new Map();

  // Serialize read-modify-write operations for each thread. Without this,
  // simultaneous replies can both read the same version and one gets lost.
  const withThreadWrite = (id, task) => {
    const previous = threadWrites.get(id) || Promise.resolve();
    const current = previous.catch(() => {}).then(task);
    threadWrites.set(id, current);
    return current.finally(() => {
      if (threadWrites.get(id) === current) threadWrites.delete(id);
    });
  };

  const originAllowed = (origin) => !allowed.length || !origin || allowed.includes(origin);

  function corsHeaders(req) {
    const origin = req.headers.get("origin");
    const h = {
      "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Vary": "Origin",
      "Content-Type": "application/json",
    };
    // Only advertise an origin that is allowed, so the browser blocks the rest.
    if (!allowed.length) h["Access-Control-Allow-Origin"] = "*";
    else if (origin && allowed.includes(origin)) h["Access-Control-Allow-Origin"] = origin;
    return h;
  }

  const isAdmin = (req) => {
    if (!adminToken) return false; // no token set: moderation is off
    const auth = req.headers.get("authorization") || "";
    return (auth.startsWith("Bearer ") ? auth.slice(7) : "") === adminToken;
  };

  async function readJson(req) {
    const len = Number(req.headers.get("content-length") || 0);
    if (len && len > MAX_BODY) return { ok: false, tooLarge: true };
    let text;
    try { text = await req.text(); } catch { return { ok: false }; }
    if (text.length > MAX_BODY) return { ok: false, tooLarge: true };
    try { return { ok: true, value: JSON.parse(text) }; } catch { return { ok: false }; }
  }

  return async function handle(req) {
    const cors = corsHeaders(req);
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: cors });
    const badBody = (p) => json({ error: p.tooLarge ? "payload too large" : "invalid JSON" }, p.tooLarge ? 413 : 400);

    // A 204 has to carry a null body.
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (!originAllowed(req.headers.get("origin"))) return json({ error: "forbidden origin" }, 403);

    const url = new URL(req.url);
    if (url.pathname !== basePath && !url.pathname.startsWith(basePath + "/")) return json({ error: "not found" }, 404);
    let seg;
    try {
      seg = url.pathname.slice(basePath.length).split("/").filter(Boolean).map(decodeURIComponent);
    } catch {
      return json({ error: "invalid path encoding" }, 400);
    }
    // The page holds no data, so it is always served. "dashboard" matches the id pattern, so
    // it is caught before the id check; real ids come from newId() and cannot be this word.
    if (req.method === "GET" && seg.length === 1 && seg[0] === "dashboard") {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      const nonce = btoa(String.fromCharCode(...bytes));
      return new Response(dashboardHtml(nonce), {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          "Content-Security-Policy": `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
          "X-Content-Type-Options": "nosniff",
          "Referrer-Policy": "no-referrer",
        },
      });
    }
    if (seg[0] !== undefined && !ID.test(seg[0])) return json({ error: "thread not found" }, 404);

    try {
      // ---- GET ?page= ----
      if (req.method === "GET" && seg.length === 0) {
        const page = url.searchParams.get("page");
        if (!page && url.searchParams.get("summary") === "1") {
          if (!isAdmin(req) && !publicDashboard) return json({ error: "admin token required" }, 403);
          return json(summarise(await storage.list()));
        }
        if (!page && !isAdmin(req)) return json({ error: "admin token required to list all pages" }, 403);
        const all = await storage.list();
        const out = (page ? all.filter((t) => t.pageId === page) : all)
          .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
        return json(out);
      }

      // ---- POST (create a thread) ----
      if (req.method === "POST" && seg.length === 0) {
        const parsed = await readJson(req);
        if (!parsed.ok) return badBody(parsed);
        const b = parsed.value || {};
        const pageId = clip(b.pageId, LIMITS.pageId).trim();
        const title = clip(b.title, LIMITS.title).trim();
        const pageUrl = safeUrl(b.url);
        const text = clip(b.text, LIMITS.text).trim();
        if (!pageId) return json({ error: "pageId is required" }, 400);
        if (!text) return json({ error: "text is required" }, 400);

        // A pin is a point on an image: its src and place in the page, plus x/y
        // as fractions (0 to 1) of the image, so it survives resizing.
        let pin;
        if (b.pin && typeof b.pin === "object") {
          const x = Number(b.pin.x), y = Number(b.pin.y), i = Number(b.pin.i);
          if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) {
            return json({ error: "pin x and y must be between 0 and 1" }, 400);
          }
          const src = clip(b.pin.src, LIMITS.src).trim();
          if (!src) return json({ error: "pin src is required" }, 400);
          pin = { src, alt: clip(b.pin.alt, LIMITS.alt), i: Number.isInteger(i) && i >= 0 && i < 10000 ? i : 0, x, y };
        }

        return withThreadWrite(`page:${pageId}`, async () => {
          const author = clip(b.author, LIMITS.author).trim() || "Anonymous";
          const existing = (await storage.list()).filter((thread) => thread.pageId === pageId);
          if (existing.length >= maxThreadsPerPage) return json({ error: "too many threads on this page" }, 429);
          // The same person saying the same thing about the same words (or the same spot on an image)
          // within the window is a double submit. The same remark on different words is not.
          const duplicate = duplicateWindowMs > 0 && existing.some((thread) => thread.author === author && thread.text === text &&
            thread.quote === clip(b.quote, LIMITS.quote) && JSON.stringify(thread.pin || null) === JSON.stringify(pin || null) &&
            Date.now() - Number(thread.createdAt || 0) < duplicateWindowMs);
          if (duplicate) return json({ error: "duplicate comment" }, 409);

          const thread = {
            id: newId(), pageId, title, url: pageUrl,
            quote: clip(b.quote, LIMITS.quote),
            prefix: clip(b.prefix, LIMITS.prefix),
            suffix: clip(b.suffix, LIMITS.suffix),
            author, text,
            ...(pin ? { pin } : {}),
            createdAt: Date.now(), resolved: false, replies: [],
          };
          await storage.put(thread);
          return json(thread, 201);
        });
      }

      // ---- POST /:id/replies ----
      if (req.method === "POST" && seg.length === 2 && seg[1] === "replies") {
        const parsed = await readJson(req);
        if (!parsed.ok) return badBody(parsed);
        const text = clip((parsed.value || {}).text, LIMITS.text).trim();
        if (!text) return json({ error: "text is required" }, 400);
        return withThreadWrite(seg[0], async () => {
          const t = await storage.get(seg[0]);
          if (!t) return json({ error: "thread not found" }, 404);
          if (!Array.isArray(t.replies)) t.replies = [];
          if (t.replies.length >= maxRepliesPerThread) return json({ error: "too many replies" }, 429);
          const author = clip((parsed.value || {}).author, LIMITS.author).trim() || "Anonymous";
          const duplicate = duplicateWindowMs > 0 && t.replies.some((reply) => reply.author === author && reply.text === text &&
            Date.now() - Number(reply.createdAt || 0) < duplicateWindowMs);
          if (duplicate) return json({ error: "duplicate reply" }, 409);
          const reply = {
            id: newId(),
            author,
            text,
            createdAt: Date.now(),
          };
          t.replies.push(reply);
          await storage.put(t);
          return json(reply, 201);
        });
      }

      // ---- PATCH /:id (resolve or reopen only) ----
      if (req.method === "PATCH" && seg.length === 1) {
        const parsed = await readJson(req);
        if (!parsed.ok) return badBody(parsed);
        const body = parsed.value || {};
        if (typeof body.resolved !== "boolean") return json({ error: "resolved (boolean) is required" }, 400);
        return withThreadWrite(seg[0], async () => {
          const t = await storage.get(seg[0]);
          if (!t) return json({ error: "thread not found" }, 404);
          t.resolved = body.resolved;
          await storage.put(t);
          return json(t);
        });
      }

      // ---- DELETE (moderation) ----
      if (req.method === "DELETE") {
        if (!isAdmin(req)) return json({ error: "forbidden" }, 403);
        // Only the bare base path clears everything. A trailing slash or an empty
        // segment (what a script sends when its $ID is unset) is refused, so a
        // mistake can't wipe the store.
        const rest = url.pathname.slice(basePath.length);
        if (rest === "") { await storage.clear(); return json({ ok: true, cleared: true }); }
        const one = rest.endsWith("/") ? rest.slice(0, -1) : rest; // one trailing slash after an id is harmless
        if (seg.length !== 1 || !/^\/[^/]+$/.test(one) || one.slice(1).trim() === "") {
          return json({ error: "a note id is required; to clear all notes use DELETE " + basePath }, 400);
        }
        return json({ ok: true, removed: (await storage.remove(seg[0])) ? 1 : 0 });
      }

      return json({ error: "unsupported", method: req.method }, 400);
    } catch (e) {
      console.error("notis error:", e);
      return json({ error: "internal error" }, 500);
    }
  };
}

// A simple in-memory store for tests and demos.
function memoryStorage() {
  const m = new Map();
  const copy = (t) => JSON.parse(JSON.stringify(t));
  return {
    list: async () => [...m.values()].map(copy),
    get: async (id) => (m.has(id) ? copy(m.get(id)) : null),
    put: async (t) => { m.set(t.id, copy(t)); },
    remove: async (id) => m.delete(id),
    clear: async () => { m.clear(); },
  };
}

// ---- end of core ----

const PREFIX = "notis/t/";
const key = (id) => `${PREFIX}${id}.json`;

export function storageFor(blob) {
  async function blobs() {
    const out = [];
    let cursor;
    do {
      const page = await blob.list({ prefix: PREFIX, cursor });
      out.push(...page.blobs);
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return out;
  }

  async function read(pathname) {
    try {
      const result = await blob.get(pathname, { access: "private", useCache: false });
      return result ? await new Response(result.stream).json() : null;
    } catch (error) {
      if (error && (error.name === "BlobNotFoundError" || error.status === 404)) return null;
      throw error;
    }
  }

  return {
    async list() {
      const rows = await Promise.all((await blobs()).map((item) => read(item.pathname)));
      return rows.filter(Boolean);
    },
    get: (id) => read(key(id)),
    async put(thread) {
      await blob.put(key(thread.id), JSON.stringify(thread), {
        access: "private",
        allowOverwrite: true,
        contentType: "application/json",
        cacheControlMaxAge: 60,
      });
    },
    async remove(id) {
      const pathname = key(id);
      const had = await read(pathname);
      if (had) await blob.del(pathname);
      return Boolean(had);
    },
    async clear() {
      const paths = (await blobs()).map((item) => item.pathname);
      if (paths.length) await blob.del(paths);
    },
  };
}

let handler;
export default function vercelHandler(request) {
  handler ??= createHandler({
    storage: storageFor({ get, list, put, del }),
    config: {
      adminToken: process.env.COMMENTS_ADMIN_TOKEN,
      allowedOrigins: (process.env.COMMENTS_ALLOWED_ORIGINS || "").split(","),
      maxThreadsPerPage: process.env.COMMENTS_MAX_THREADS_PER_PAGE,
      maxRepliesPerThread: process.env.COMMENTS_MAX_REPLIES_PER_THREAD,
      duplicateWindowMs: process.env.COMMENTS_DUPLICATE_WINDOW_MS,
      dashboard: process.env.COMMENTS_DASHBOARD,
      basePath: "/api/comments",
    },
  });
  return handler(request);
}
