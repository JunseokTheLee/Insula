#!/usr/bin/env node
// Stamps one shared cache-busting version onto every /js/… and /css/… link in
// en/*.html and ko/*.html:
//   src="/js/auth.js"            ->  src="/js/auth.js?v=20260909-214134"
//   href="/css/base.css?v=old"   ->  href="/css/base.css?v=20260909-214134"
//
// Why: /js/* and /css/* are cached for a year (see _headers). A changed file
// served at the SAME URL would keep coming from browser/edge caches for hours,
// and files could even mix (a new auth.js next to an old i18n file). Changing
// the URL on every deploy makes every cache fetch the new set together. The
// value is a second-resolution local timestamp, so several deploys on one day
// each get their own version (a date-only stamp would collide).
//
// Run it before committing any JS/CSS change — tools/git-hooks/pre-commit does
// this automatically once a clone has run: git config core.hooksPath tools/git-hooks
//
// Usage: node tools/bump-asset-version.js [explicit-version]
"use strict";
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const PAGE_DIRS = ['en', 'ko'];
// Matches src="/js/…" / href="/css/…" (with or without an existing ?v=) inside
// double-quoted attributes only — that is the one form the pages use.
const LINK_RE = /((?:src|href)=")(\/(?:js|css)\/[^"?]+)(?:\?v=[^"]*)?(")/g;

function stamp() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

const version = process.argv[2] || stamp();
if (!/^[\w.-]+$/.test(version)) {
  console.error(`bump-asset-version: invalid version "${version}" (letters, digits, . _ - only)`);
  process.exit(1);
}

let files = 0, links = 0;
for (const dir of PAGE_DIRS) {
  for (const name of fs.readdirSync(path.join(root, dir))) {
    if (!name.endsWith('.html')) continue;
    const file = path.join(root, dir, name);
    const src = fs.readFileSync(file, 'utf8');
    let n = 0;
    const out = src.replace(LINK_RE, (m, open, url, close) => { n++; return `${open}${url}?v=${version}${close}`; });
    if (n) { fs.writeFileSync(file, out); files++; links += n; }
  }
}
if (!links) {
  console.error('bump-asset-version: no /js or /css links found — nothing stamped');
  process.exit(1);
}
console.log(`asset version ${version} -> ${links} links in ${files} files`);
