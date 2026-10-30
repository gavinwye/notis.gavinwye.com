// Turns CHANGELOG.md into the site's /changelog.html. The changelog only uses a few Markdown
// shapes (headings, paragraphs, bullets, bold, code, links and link references), so this
// handles exactly those and escapes everything else. Nothing here runs in the browser.

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Inline: `code`, **bold**, [text](url) and [text][ref] / [text]. Only http(s) and relative links are kept.
function inline(text, refs) {
  const safe = (u) => (/^(https?:\/\/|\/|#)/i.test(u) ? esc(u) : "");
  const stash = [];
  let s = String(text).replace(/`([^`]+)`/g, (_, c) => { stash.push(`<code>${esc(c)}</code>`); return `\u0000${stash.length - 1}\u0000`; });
  s = esc(s);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, t, u) => (safe(u.replace(/&amp;/g, "&")) ? `<a href="${safe(u.replace(/&amp;/g, "&"))}">${t}</a>` : t));
  s = s.replace(/\[([^\]]+)\](?!\()/g, (m, t) => (refs[t] && safe(refs[t]) ? `<a href="${safe(refs[t])}">${t}</a>` : m));
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => stash[Number(i)]);
}

/** The changelog as the body of a page: one section per version, newest first as written. */
export function renderChangelogBody(md) {
  const refs = {};
  const lines = String(md).replace(/\r\n/g, "\n").split("\n").filter((l) => {
    const m = /^\[([^\]]+)\]:\s*(\S+)\s*$/.exec(l);
    if (m) { refs[m[1]] = m[2]; return false; }
    return true;
  });
  const out = [];
  let list = false, para = [], section = null, sectionHasContent = false, buffer = [];
  const flushPara = () => { if (para.length) { buffer.push(`<p>${inline(para.join(" "), refs)}</p>`); sectionHasContent = true; para = []; } };
  const closeList = () => { if (list) { buffer.push("</ul>"); list = false; } };
  const flushSection = () => {
    flushPara(); closeList();
    // An empty "Unreleased" heading is noise on a public page.
    if (section !== null && (sectionHasContent || section.id !== "unreleased")) out.push(section.html, ...buffer, "</section>");
    section = null; buffer = []; sectionHasContent = false;
  };
  for (const line of lines) {
    let m;
    if ((m = /^## (.*)$/.exec(line))) {
      flushSection();
      const title = m[1].trim();
      const ver = /^\[([^\]]+)\](.*)$/.exec(title);
      const id = ver ? ver[1].toLowerCase() : title.toLowerCase().replace(/[^a-z0-9.]+/g, "-");
      section = { id, html: `<section id="${esc(id)}"><h2>${inline(title, refs)}</h2>` };
    } else if (section === null) {
      continue; // the title and intro paragraph before the first version
    } else if ((m = /^### (.*)$/.exec(line))) {
      flushPara(); closeList(); buffer.push(`<h3>${inline(m[1].trim(), refs)}</h3>`);
    } else if ((m = /^- (.*)$/.exec(line))) {
      flushPara();
      if (!list) { buffer.push("<ul>"); list = true; }
      buffer.push(`<li>${inline(m[1], refs)}</li>`); sectionHasContent = true;
    } else if (/^\s+\S/.test(line) && list) {
      buffer[buffer.length - 1] = buffer[buffer.length - 1].replace(/<\/li>$/, ` ${inline(line.trim(), refs)}</li>`);
    } else if (line.trim() === "") {
      flushPara(); closeList();
    } else {
      closeList(); para.push(line.trim());
    }
  }
  flushSection();
  return out.join("\n");
}

export function renderChangelogPage(md, { version } = {}) {
  return `<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Changelog — Notis</title>
<meta name="description" content="What changed in each version of Notis, and which of your files to replace.">
<link rel="canonical" href="https://notis.gavinwye.com/changelog.html">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<style>
  :root { color-scheme:light dark; --paper:#fff; --ink:#0b0c0c; --muted:#4b5559; --line:#d8dde0; --mark:#ffc726; }
  @media (prefers-color-scheme:dark) { :root { --paper:#111517; --ink:#f1f3f4; --muted:#aab3b7; --line:#2f373b; } }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--paper); color:var(--ink); font:18px/1.55 system-ui,sans-serif; }
  header, main, footer { max-width:720px; margin:auto; padding:24px 20px; }
  header { border-bottom:1px solid var(--line); }
  main { padding-top:48px; padding-bottom:48px; }
  footer { border-top:1px solid var(--line); color:var(--muted); font-size:15px; }
  h1 { font-size:clamp(38px,8vw,64px); line-height:1.05; margin:0 0 16px; }
  h2 { font-size:28px; margin:0 0 8px; padding-top:24px; border-top:2px solid var(--ink); }
  h3 { font-size:20px; margin:20px 0 6px; }
  section { margin-top:40px; }
  p, ul { margin:0 0 16px; }
  li { margin-bottom:8px; overflow-wrap:anywhere; }
  a { color:inherit; text-decoration-color:var(--mark); text-decoration-thickness:2px; text-underline-offset:3px; }
  code { font-family:ui-monospace,monospace; font-size:.9em; }
  .lede { color:var(--muted); }
</style>
</head>
<body>
<header><a href="/">← Notis</a></header>
<main>
  <h1>Changelog</h1>
  <p class="lede">What changed in each version, in plain English. Notis has two files you copy: the script on your pages (<code>comments.js</code>), which adds the Notis button, and the server file, which stores the notes. Each version says in short what is new, then what to do: which of the two files to replace.${version ? ` The current version is ${esc(version)}.` : ""}</p>
${renderChangelogBody(md)}
</main>
<footer>Notis is open source and MIT licensed. <a href="https://github.com/gavinwye/notis.gavinwye.com">View the source</a>.</footer>
</body>
</html>
`;
}
