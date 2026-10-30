import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ROOT } from "../scripts/lib.mjs";
import { renderChangelogBody, renderChangelogPage } from "../scripts/changelog.mjs";

const md = `# Changelog

Intro that is dropped.

## [Unreleased]

## [1.2.0] - 2026-01-02

**Widget: yes. Server: no.** Replace one file.

### Added
- A thing with \`code\` and a link ([#9](https://example.com/9)). It wraps
  onto a second line.
- <script>alert(1)</script> and [bad](javascript:alert(1)).

## [1.1.0] - 2025-12-01

### Fixed
- Old.

[1.2.0]: https://example.com/compare/1.1.0...1.2.0
[1.1.0]: https://example.com/releases/tag/1.1.0
`;

test("changelog: versions become sections with their heading linked", () => {
  const html = renderChangelogBody(md);
  assert.match(html, /<section id="1\.2\.0"><h2><a href="https:\/\/example\.com\/compare\/1\.1\.0\.\.\.1\.2\.0">1\.2\.0<\/a> - 2026-01-02<\/h2>/);
  assert.match(html, /<section id="1\.1\.0">/);
  assert.ok(!html.includes("Intro that is dropped"));
  assert.match(html, /<strong>Widget: yes\. Server: no\.<\/strong> Replace one file\./);
});

test("changelog: an empty Unreleased section is left out, a filled one is kept", () => {
  assert.ok(!renderChangelogBody(md).includes("Unreleased"));
  assert.match(renderChangelogBody("## [Unreleased]\n\n### Added\n- Soon.\n"), /<section id="unreleased">/);
});

test("changelog: code, links and wrapped bullets render, and HTML and unsafe links do not", () => {
  const html = renderChangelogBody(md);
  assert.match(html, /<li>A thing with <code>code<\/code> and a link \(<a href="https:\/\/example\.com\/9">#9<\/a>\)\. It wraps onto a second line\.<\/li>/);
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(!/href="javascript/i.test(html));
});

test("the repo's own changelog renders every released version", async () => {
  const page = renderChangelogPage(await readFile(join(ROOT, "CHANGELOG.md"), "utf8"), { version: "9.9.9" });
  for (const v of ["0.3.2", "0.3.1", "0.3.0", "0.2.0", "0.1.0"]) assert.ok(page.includes(`id="${v}"`), v);
  assert.ok(page.includes("The current version is 9.9.9."));
});
