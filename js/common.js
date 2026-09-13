// Shared helpers used across every page. Loaded after supabase-client.js
// and the page's js/i18n/{en,ko}.js (which define tr()/T/CURRENT_LANG).
"use strict";

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2200);
}
function escapeHtml(s) {
  const d = document.createElement('div'); d.textContent = s; return d.innerHTML;
}

// The artwork "year completed" field is a year only, but it's stored in the
// existing date column mosaic_submissions.art_completed_date as YYYY-01-01
// (month/day are a fixed placeholder — no schema change needed, and the
// `art_completed_date <= current_date` check still holds for any past year
// or Jan 1 of the current one). The UI only ever shows/collects the year:
// input in js/profile-view.js's upload form and js/lightbox.js's edit
// modal, rendered via fmtCompletedYear() in the i18n files.
const MIN_ART_YEAR = 1900;
function artDateToYear(dateStr) {
  return dateStr ? String(dateStr).slice(0, 4) : '';
}
// { date } for a valid year or blank input; { error } for anything else.
function artYearToDate(yearStr) {
  const raw = String(yearStr || '').trim();
  if (!raw) return { date: null };
  const y = Number(raw);
  const maxYear = new Date().getFullYear();
  if (!Number.isInteger(y) || y < MIN_ART_YEAR || y > maxYear) {
    return { error: tr('artCompletedYearInvalid', { min: MIN_ART_YEAR, max: maxYear }) };
  }
  return { date: `${y}-01-01` };
}

// Submissions/profile links are user-supplied — only ever wire up http(s)
// links as an href so a submission can't sneak in a javascript: URI.
function safeHref(url) {
  try {
    const u = new URL(url, location.href);
    return (u.protocol === 'http:' || u.protocol === 'https:') ? u.href : null;
  } catch { return null; }
}

// Rewrites a Supabase Storage public URL to route through the same-origin
// /img/ proxy (functions/img/[[path]].js), which caches objects at
// Cloudflare's edge — repeat views then no longer count against Supabase's
// billed egress. Anything that isn't a Supabase storage URL (e.g. a Google
// OAuth avatar photo) passes through unchanged.
const SUPABASE_STORAGE_PREFIX = `${SUPABASE_URL}/storage/v1/object/public/`;
function cdnUrl(url) {
  if (!url || !url.startsWith(SUPABASE_STORAGE_PREFIX)) return url;
  return `/img/${url.slice(SUPABASE_STORAGE_PREFIX.length)}`;
}

// A collection's cover thumb is whichever item was added to it most
// recently — shared by the profile grid and the landing page's collections
// section. `collection.mosaic_collection_items` must be embedded with each
// item's `added_at` and its `mosaic_submissions(thumb_url,image_url)`.
function collectionCoverUrl(collection) {
  const items = collection.mosaic_collection_items || [];
  if (!items.length) return null;
  const latest = items.reduce((a, b) => (new Date(a.added_at) > new Date(b.added_at) ? a : b));
  const sub = latest.mosaic_submissions;
  return sub ? cdnUrl(sub.thumb_url || sub.image_url) : null;
}

// Card for a public collection ("Exhibition") — same shell as an artwork
// card (.artwork-card, css/home.css), but the byline is the exhibition's
// owner rather than an artwork's author, and the date line is repurposed
// for the piece count. Shared by the landing page's Latest Exhibitions
// section (js/landing.js) and the /exhibitions browse-all page
// (js/exhibitions.js). `owner` may be null (profile lookup still pending
// or missing) and falls back to an "Anonymous" initial avatar.
function exhibitionCardEl(collection, owner, i) {
  const name = (owner && owner.username) || tr('anonymous');
  const card = document.createElement('a');
  card.className = 'artwork-card';
  card.href = collectionUrl(collection.id);
  card.style.animationDelay = `${Math.min(i, 10) * 0.05}s`;

  const coverUrl = collectionCoverUrl(collection);
  if (coverUrl) {
    const img = document.createElement('img');
    img.className = 'artwork-card-img';
    img.loading = 'lazy';
    img.src = coverUrl;
    img.alt = '';
    card.appendChild(img);
  } else {
    const empty = document.createElement('div');
    empty.className = 'artwork-card-img collection-card-img-empty';
    card.appendChild(empty);
  }

  const info = document.createElement('div'); info.className = 'info';
  const title = document.createElement('div');
  title.className = 'art-title'; title.textContent = collection.title;
  const byline = document.createElement('div'); byline.className = 'art-byline';
  if (owner && owner.avatar_url) {
    const avatar = document.createElement('img');
    avatar.className = 'art-byline-avatar'; avatar.loading = 'lazy'; avatar.src = cdnUrl(owner.avatar_url); avatar.alt = '';
    byline.appendChild(avatar);
  } else {
    const fallback = document.createElement('div');
    fallback.className = 'art-byline-avatar art-byline-avatar-fallback';
    fallback.textContent = name.charAt(0).toUpperCase();
    byline.appendChild(fallback);
  }
  const nameSpan = document.createElement('span'); nameSpan.className = 'art-byline-name'; nameSpan.textContent = name;
  byline.appendChild(nameSpan);
  const count = document.createElement('div'); count.className = 'art-date';
  count.textContent = collectionItemCountText((collection.mosaic_collection_items || []).length);
  info.append(title, byline, count);
  card.appendChild(info);
  return card;
}

// Batch-fetches the owner profiles for a set of public collections (which
// only carry owner_id — see collectionCoverUrl's comment for why this isn't
// embedded) and returns an {ownerId: profile} map ready for exhibitionCardEl.
async function fetchExhibitionOwners(collections) {
  const ownerIds = [...new Set(collections.map(c => c.owner_id))];
  const owners = {};
  if (!ownerIds.length) return owners;
  const { data: profiles, error } = await sb.from('profiles')
    .select('id,username,avatar_url').in('id', ownerIds);
  if (error) console.error('load exhibition owners error:', error);
  else for (const p of profiles || []) owners[p.id] = p;
  return owners;
}

// Local-timezone Y-M-D (not UTC) — matches how end_date, a plain `date`
// column with no timezone of its own, reads to the person looking at it.
function todayDateStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
// An exhibition only counts as "live" for discovery surfaces once it's both
// published and, if it set a self-expiry, that date hasn't passed yet — see
// supabase_mosaic_collections_publish.sql for why end_date is checked here
// rather than a stored flag a scheduled job would need to flip.
function isExhibitionLive(collection) {
  if (!collection.is_published) return false;
  if (!collection.end_date) return true;
  return collection.end_date >= todayDateStr();
}
// Public, published, not-(yet-)expired exhibitions, most recently published
// first — shared by the landing page's Latest Exhibitions list and the
// /exhibitions browse-all page. `limit` is optional (browse-all wants
// everything; the landing page passes 5).
async function fetchPublishedExhibitions(limit) {
  let query = sb.from('mosaic_collections')
    .select('id,owner_id,title,published_at,mosaic_collection_items(added_at,mosaic_submissions(thumb_url,image_url))')
    .eq('is_public', true)
    .eq('is_published', true)
    .or(`end_date.is.null,end_date.gte.${todayDateStr()}`)
    .order('published_at', { ascending: false });
  if (limit) query = query.limit(limit);
  const { data, error } = await query;
  if (error) { console.error('load exhibitions error:', error); toast(tr('couldNotLoadCollections')); return []; }
  return data || [];
}

// A single row for the landing page's compact "recent activity" lists
// (Latest Exhibitions / Latest Artworks) — thumbnail, title, byline, and a
// trailing meta bit (piece count or date). `onPlainClick`, if given, is
// wired through interceptClick — a plain click runs it in place (e.g. opens
// the artwork lightbox) while the real href still supports modifier-click/
// ctrl-click/share. `thumbUrl` may be null (no cover yet).
function recentListRowEl({ href, thumbUrl, title, avatarUrl, name, metaText, onPlainClick }) {
  const row = document.createElement('a');
  row.className = 'recent-list-row';
  row.href = href;
  if (onPlainClick) interceptClick(row, onPlainClick);

  const img = document.createElement('img');
  img.className = thumbUrl ? 'recent-list-thumb' : 'recent-list-thumb recent-list-thumb-empty';
  img.loading = 'lazy';
  // Some older artworks have no thumb_url and fall back to the full-res
  // original (see callers) — lazy-loading keeps those off the critical path.
  if (thumbUrl) img.src = thumbUrl;
  img.alt = '';
  row.appendChild(img);

  const info = document.createElement('div'); info.className = 'recent-list-info';
  const titleEl = document.createElement('div'); titleEl.className = 'recent-list-title'; titleEl.textContent = title;
  const meta = document.createElement('div'); meta.className = 'recent-list-meta';
  if (avatarUrl) {
    const avatar = document.createElement('img');
    avatar.className = 'recent-list-avatar'; avatar.loading = 'lazy'; avatar.src = avatarUrl; avatar.alt = '';
    meta.appendChild(avatar);
  } else {
    const fallback = document.createElement('div');
    fallback.className = 'recent-list-avatar recent-list-avatar-fallback';
    fallback.textContent = (name || '?').charAt(0).toUpperCase();
    meta.appendChild(fallback);
  }
  const nameSpan = document.createElement('span'); nameSpan.className = 'recent-list-meta-name'; nameSpan.textContent = name;
  meta.appendChild(nameSpan);
  if (metaText) {
    const sep = document.createElement('span'); sep.textContent = '·'; sep.setAttribute('aria-hidden', 'true');
    const extra = document.createElement('span'); extra.textContent = metaText;
    meta.append(sep, extra);
  }
  info.append(titleEl, meta);
  row.appendChild(info);
  const arrow = document.createElement('span'); arrow.className = 'recent-list-arrow'; arrow.textContent = '→'; arrow.setAttribute('aria-hidden', 'true');
  row.appendChild(arrow);
  return row;
}

function loadImageEl(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// Every profile link (in the topnav, an artwork byline, a comment author, a
// graph node) points here — a real, crawlable path (served by the
// functions/[lang]/artists/[handle].js Pages Function) rendered with a
// server-fetched username/id lookup. Root-relative (not relative to the
// current document) so it resolves the same regardless of how deep the
// current URL's path is (e.g. from /en/campaigns/abc, a bare "artists/x"
// would resolve to /en/campaigns/artists/x — wrong).
function profileUrl(userId) {
  return `/${CURRENT_LANG}/artists/${encodeURIComponent(userId)}`;
}
// Real path to a project's detail page (functions/[lang]/campaigns/[id].js).
function projectUrl(id) {
  return `/${CURRENT_LANG}/campaigns/${encodeURIComponent(id)}`;
}
// Real path to a single artwork's own page (functions/[lang]/artworks/[id].js) —
// the same piece a lightbox shows inline, but at a shareable, indexable URL.
function artworkUrl(id) {
  return `/${CURRENT_LANG}/artworks/${encodeURIComponent(id)}`;
}
// Real path to a collection's own page (functions/[lang]/collections/[id].js).
function collectionUrl(id) {
  return `/${CURRENT_LANG}/collections/${encodeURIComponent(id)}`;
}

// Reads an entity id/handle out of the current URL: the path segment right
// after /{lang}/{prefix}/ when this page was reached through its clean,
// Pages-Function-rendered route (e.g. /en/campaigns/abc -> "abc"), falling
// back to the legacy ?id=/?user= query form for direct, unrewritten access
// to the underlying template file (project.html, profile.html) — which is
// also how the Pages Function itself fetches the static asset it rewrites.
// Wires a real <a href> element so a plain left-click runs `onPlainClick`
// (opening a lightbox in place, in every current use) instead of navigating,
// while a modifier-click (ctrl/cmd/shift, middle-click, or anything else the
// browser treats as "open in new tab/window") still gets native browser
// behavior, since preventDefault() only ever runs for a plain click. The
// href itself is what makes the element a real, crawlable, share/copy-link-
// able, new-tab-openable link either way — this only intercepts the common case.
function interceptClick(el, onPlainClick) {
  el.addEventListener('click', e => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    onPlainClick(e);
  });
}

// Client-side fallback that keeps the tab title/social-preview tags correct
// for entity detail pages (project/artwork/artist), in case this page is
// ever reached without going through the Pages Function that pre-renders
// these same tags server-side (see functions/[lang]/.../[id].js) — e.g.
// local testing straight against project.html. `image`, when given, is an
// absolute URL; canonical/title/description are required.
function updatePageMeta({ title, description, canonical, image }) {
  document.title = title;
  const set = (selector, attr, value) => { const el = document.querySelector(selector); if (el) el.setAttribute(attr, value); };
  set('meta[name="description"]', 'content', description);
  set('link[rel="canonical"]', 'href', canonical);
  set('meta[property="og:title"]', 'content', title);
  set('meta[property="og:description"]', 'content', description);
  set('meta[property="og:url"]', 'content', canonical);
  set('meta[name="twitter:title"]', 'content', title);
  set('meta[name="twitter:description"]', 'content', description);
  if (image) { set('meta[property="og:image"]', 'content', image); set('meta[name="twitter:image"]', 'content', image); }
}
// Appends one JSON-LD <script> block per object, first removing whatever
// this function itself previously injected (marked with data-dynamic-jsonld)
// — detail pages like project.html re-render the same entity repeatedly
// (reshape, re-opening an archived iteration, etc.), and without this a
// stale/duplicate <script> would pile up in <head> on every call instead of
// being replaced. Static pages' hand-written JSON-LD (home, about) has no
// such attribute and is left alone. JSON.stringify already escapes quotes/
// control characters; user-generated text (titles, bios, descriptions)
// could still contain a literal "</" that would otherwise prematurely close
// the script tag, so that sequence is escaped separately.
function injectJsonLd(objects) {
  document.querySelectorAll('script[data-dynamic-jsonld]').forEach(el => el.remove());
  for (const obj of objects) {
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.dataset.dynamicJsonld = '1';
    script.textContent = JSON.stringify(obj).replace(/<\//g, '<\\/');
    document.head.appendChild(script);
  }
}

// Supabase/PostgREST caps every response at 1,000 rows (the project's
// default "Max rows"), silently — a 58×86 campaign (4,988 cells) came back
// as its first 1,000 cells, so the grid drew only the top rows, "x / total"
// showed 1000, and matching only ever saw those rows. Any query that can
// exceed 1,000 rows must go through this instead of awaiting the builder.
//
// `build` returns a FRESH query builder each time (a builder can't be reused
// once .range() has been applied). Pages are ordered by `orderBy` (default
// the row id; extra .order() calls inside `build` are kept as primary keys)
// so consecutive ranges never overlap or skip. Page count comes from
// `expected` (e.g. width × height — an upper bound is fine, spare pages just
// come back empty) or from the first page's count when `build` selected with
// { count: 'exact' }; those pages are then fetched in parallel. Without
// either it pages sequentially until a short page.
const PAGE_ROWS = 1000;
async function fetchAllRows(build, { orderBy = 'id', expected = null } = {}) {
  const page = i => build().order(orderBy, { ascending: true }).range(i * PAGE_ROWS, (i + 1) * PAGE_ROWS - 1);
  const first = await page(0);
  if (first.error) return { data: null, error: first.error };
  const rows = first.data || [];
  const total = expected != null ? expected : (typeof first.count === 'number' ? first.count : null);
  if (total != null) {
    const pages = Math.ceil(total / PAGE_ROWS);
    if (pages <= 1 || rows.length < PAGE_ROWS) return { data: rows, error: null };
    const rest = await Promise.all(Array.from({ length: pages - 1 }, (_, i) => page(i + 1)));
    const failed = rest.find(r => r.error);
    if (failed) return { data: null, error: failed.error };
    return { data: rows.concat(...rest.map(r => r.data || [])), error: null };
  }
  const all = rows.slice();
  for (let i = 1; rows.length >= PAGE_ROWS; i++) {
    const { data, error } = await page(i);
    if (error) return { data: null, error };
    all.push(...(data || []));
    if (!data || data.length < PAGE_ROWS) break;
  }
  return { data: all, error: null };
}

// ---------- project grid image (static cell colors) ----------
// A campaign's cell target colors are a fixed picture until the next
// reshape, so they're kept as a width×height PNG in Storage (one pixel per
// cell, alpha 0 where the reference image had no cell) and read through the
// /img/ edge cache — instead of every visitor pulling every mosaic_pixels
// row (0.7 MB / 16 requests for a 4,988-cell campaign, ~5 MB at 30,000).
// See supabase_mosaic_grid_image.sql. The pixel rows stay the source of
// truth for claims; if a project has no image yet (created before this
// existed, or the upload failed) or it doesn't load / doesn't match the
// project's dimensions, loadProjectCells() silently falls back to the rows.

// Encode a cells array (imageToColorGrid output) as a PNG Blob.
function gridImageBlob(cells, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(width, height);
  for (const c of cells) {
    const i = (c.y * width + c.x) * 4;
    img.data[i] = c.target_r; img.data[i + 1] = c.target_g; img.data[i + 2] = c.target_b; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}
// Renders + uploads the grid image; resolves to its public URL, or null on
// any failure (the caller then just stores no image and the fallback runs).
async function uploadGridImage(cells, width, height) {
  try {
    const blob = await gridImageBlob(cells, width, height);
    if (!blob) return null;
    return await uploadImage(new File([blob], `grid-${width}x${height}.png`, { type: 'image/png' }));
  } catch (e) {
    console.error('uploadGridImage failed:', e);
    return null;
  }
}
// Decode a project's grid image back into cells; null if unavailable.
async function loadGridImageCells(project) {
  if (!project || !project.grid_image_url) return null;
  try {
    const img = await loadImageEl(cdnUrl(project.grid_image_url));
    if (img.naturalWidth !== project.width || img.naturalHeight !== project.height) return null;
    const canvas = document.createElement('canvas');
    canvas.width = project.width; canvas.height = project.height;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, project.width, project.height).data;
    const cells = [];
    for (let y = 0; y < project.height; y++) {
      for (let x = 0; x < project.width; x++) {
        const i = (y * project.width + x) * 4;
        if (d[i + 3] < 128) continue; // transparent = no cell there
        cells.push({ x, y, target_r: d[i], target_g: d[i + 1], target_b: d[i + 2] });
      }
    }
    return cells.length ? cells : null;
  } catch (e) {
    console.warn('grid image unavailable, falling back to pixel rows:', e);
    return null;
  }
}
// { cells, source: 'image' | 'db' } — memoized per project id + version so
// the several renderers on one page share a single load.
const projectCellsCache = new Map();
function loadProjectCells(project) {
  weavoMark('cells:load');
  const key = `${project.id}:${project.version_number || 0}:${project.grid_image_url || ''}`;
  if (!projectCellsCache.has(key)) {
    projectCellsCache.set(key, (async () => {
      const fromImage = await loadGridImageCells(project);
      if (fromImage) return { cells: fromImage, source: 'image' };
      const { data, error } = await fetchAllRows(
        () => sb.from('mosaic_pixels').select('x,y,target_r,target_g,target_b').eq('project_id', project.id),
        { expected: project.width * project.height }
      );
      if (error) { console.error('load project cells error:', error); projectCellsCache.delete(key); return { cells: [], source: 'db', error }; }
      return { cells: data || [], source: 'db' };
    })());
  }
  return projectCellsCache.get(key);
}
// ---------- open-cell grey ----------
// Open (unfilled) cells are drawn as grey. openCellGrayer(cells, settings)
// returns the (r, g, b) → grey function for one campaign: each cell's
// luminance is re-centred from the reference's own mean luminance onto the
// previewBrightness level, and its distance from that mean is scaled by
// previewContrast — so every campaign's open cells average the same
// brightness whatever the photo's exposure, and the spread (what makes the
// picture recognisable) shrinks with the contrast. `cells` is the whole
// grid, filled ones included, so the mean does not drift as pieces land.
// openCellPainter(cells, settings) wraps it with the previewTint colour:
// the grey is multiplied by the tint's per-channel ratio to its own
// luminance, so hue and saturation follow the tint at any brightness and
// a neutral tint leaves plain grey. It returns the CSS colour string every
// renderer of open cells paints with (project-preview.js, project.js, the
// share card below, the admin page's slider preview), so the look is
// defined once. Needs color-engine.js's luminance() by call time.
// `settings` is a getSiteSettings() result (defaults fill any gap).
function openCellOption(settings, key) {
  const v = Number(settings && settings[key]);
  return Math.min(100, Math.max(0, Number.isFinite(v) ? v : SITE_SETTING_DEFAULTS[key]));
}
function openCellGrayer(cells, settings) {
  const contrast = openCellOption(settings, 'previewContrast') / 100;
  const level = openCellOption(settings, 'previewBrightness') / 100 * 255;
  let sum = 0, n = 0;
  for (const c of cells || []) { sum += luminance(c.target_r, c.target_g, c.target_b); n++; }
  const mean = n ? sum / n : 128;
  return (r, g, b) => Math.round(Math.min(255, Math.max(0, level + (luminance(r, g, b) - mean) * contrast)));
}
function openCellTint(settings) {
  const raw = String((settings && settings.previewTint) || '').trim();
  const hex = /^#[0-9a-f]{6}$/i.test(raw) ? raw : SITE_SETTING_DEFAULTS.previewTint;
  const tr = parseInt(hex.slice(1, 3), 16), tg = parseInt(hex.slice(3, 5), 16), tb = parseInt(hex.slice(5, 7), 16);
  const tl = luminance(tr, tg, tb);
  return tl > 0 ? { kr: tr / tl, kg: tg / tl, kb: tb / tl } : { kr: 1, kg: 1, kb: 1 };
}
function openCellPainter(cells, settings) {
  const gray = openCellGrayer(cells, settings);
  const { kr, kg, kb } = openCellTint(settings);
  const ch = v => Math.round(Math.min(255, Math.max(0, v)));
  return (r, g, b) => { const l = gray(r, g, b); return `rgb(${ch(l * kr)},${ch(l * kg)},${ch(l * kb)})`; };
}
// Kept for browsers still running the previous project-preview.js /
// project.js (cache transition, CLAUDE.md §12): the earlier per-color
// version, pivoting on mid-grey, and its option reader. New code uses
// openCellPainter with getSiteSettings.
function openCellGray(r, g, b, contrast) {
  const c = Number(contrast);
  const k = (Number.isFinite(c) ? Math.min(100, Math.max(0, c)) : SITE_SETTING_DEFAULTS.previewContrast) / 100;
  return Math.round(128 + (luminance(r, g, b) - 128) * k);
}
async function getPreviewContrast() {
  const settings = await getSiteSettings();
  const c = Number(settings.previewContrast);
  return Number.isFinite(c) ? c : SITE_SETTING_DEFAULTS.previewContrast;
}

// ---------- campaign share image (og:image) ----------
// A 1200×630 card with the campaign drawn as the site shows it — every
// cell in the open-cell grey (openCellPainter, at the previewContrast /
// previewBrightness / previewTint options current when the card is made)
// on white — for
// social previews and
// crawlers, instead of the reference photo, which stays hidden until the
// campaign is complete (supabase_mosaic_preview_image.sql). Made in the
// browser on create / reshape and from the admin page ("create" for older
// campaigns, "recreate" after the contrast option changes). Needs
// color-engine.js's luminance() by call time.
const PREVIEW_CARD_W = 1200;
const PREVIEW_CARD_H = 630;
function previewImageBlob(cells, width, height, settings) {
  const paint = openCellPainter(cells, settings);
  const canvas = document.createElement('canvas');
  canvas.width = PREVIEW_CARD_W; canvas.height = PREVIEW_CARD_H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, PREVIEW_CARD_W, PREVIEW_CARD_H);
  const pad = 40;
  const cell = Math.max(1, Math.floor(Math.min((PREVIEW_CARD_W - pad * 2) / width, (PREVIEW_CARD_H - pad * 2) / height)));
  const ox = Math.round((PREVIEW_CARD_W - cell * width) / 2);
  const oy = Math.round((PREVIEW_CARD_H - cell * height) / 2);
  for (const c of cells) {
    ctx.fillStyle = paint(c.target_r, c.target_g, c.target_b);
    ctx.fillRect(ox + c.x * cell, oy + c.y * cell, Math.max(1, cell - 1), Math.max(1, cell - 1));
  }
  return new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85));
}
// Renders + uploads the share image; resolves to its public URL, or null on
// any failure (the page then falls back to the site logo).
async function uploadPreviewImage(cells, width, height) {
  try {
    const blob = await previewImageBlob(cells, width, height, await getSiteSettings());
    if (!blob) return null;
    return await uploadImage(new File([blob], `share-${width}x${height}.jpg`, { type: 'image/jpeg' }));
  } catch (e) {
    console.error('uploadPreviewImage failed:', e);
    return null;
  }
}

// PostgREST's "unknown column" / "unknown function" errors — used by the
// creation/reshape paths to retry without the new grid-image argument while
// supabase_mosaic_grid_image.sql hasn't been applied yet.
function isSchemaMismatchError(error) {
  return !!error && (error.code === '42703' || error.code === 'PGRST204' || error.code === 'PGRST202' || error.code === '42883');
}

// ---------- site options (site_settings) ----------
// One jsonb row that admins edit on /admin ("Site options") and any page can
// read — see supabase_site_settings.sql. The row holds only the keys an
// admin has changed; everything else takes SITE_SETTING_DEFAULTS, so adding
// an option is: a default here, a data-setting="<key>" checkbox in en/ko
// admin.html, and a getSiteSettings() read where it applies. Fetched lazily
// (pages that never ask pay nothing), one request per page, remembered in
// sessionStorage for SITE_SETTINGS_TTL_MS so moving between pages doesn't
// re-fetch; an admin's own save writes through that copy immediately.
const SITE_SETTING_DEFAULTS = Object.freeze({
  // Corner "Preview" thumbnail (the reference colors) on the campaign page.
  showCampaignPreview: false,
  // Daily visitor counting for the admin "Visitors" section. record_visit()
  // in supabase_visit_stats.sql reads this same key, so "off" is enforced on
  // the server too, not merely skipped by the browser (see js/auth.js).
  countVisits: true,
  // The grey that open cells are drawn in (home hero, campaign cards,
  // campaign grid, share card) — applied at draw time by openCellGrayer().
  // Contrast: 100 keeps the reference's own light-and-dark spread, 0 is
  // flat grey. Kept low so the photo stays hard to make out until the
  // pieces reveal it.
  previewContrast: 40,
  // Brightness: the average grey level (0 black, 50 mid-grey, 100 white)
  // that every campaign's open cells are re-centred onto, whatever the
  // photo's exposure. 70 = a light grey.
  previewBrightness: 70,
  // Tint: the colour the grey leans toward — only its hue and saturation
  // are used (openCellPainter multiplies the grey by the colour's per-
  // channel ratio to its own luminance), the level still comes from
  // previewBrightness. #DCE4ED = light grey with a faint blue; a neutral
  // grey such as #808080 means no tint.
  previewTint: '#DCE4ED',
  pieceGrid: 7, // artwork cut into pieceGrid × pieceGrid pieces for the mosaic (supabase_mosaic_pieces.sql)
  pieceMatchDistance: 20, // a piece takes a cell only within this Lab distance (server-enforced)
  // Upload rate limit, enforced by the insert trigger in
  // supabase_admin_moderation.sql (not by anything in the browser — the
  // anon key lets a script call PostgREST directly). Generous on purpose:
  // it exists to stop a runaway script, not to pace a real artist
  // uploading a portfolio. Pieces don't count, only artworks.
  uploadLimitCount: 20,
  uploadLimitMinutes: 10,
  // "Find the piece" game (/{lang}/game, js/game.js, supabase_game.sql).
  // gameEnabled is checked by start_game in the database too, not just by
  // hiding the page — an RPC can be called directly with the public key.
  gameEnabled: true,
  gameRankingEnabled: true,
  gameAnonymousPlayEnabled: true,
  gameSoundDefault: true,
  // Seconds added to the recorded time per sector hint. A hint narrows
  // ~5,000 cells to a few hundred, so it has to cost roughly what finding
  // one piece unaided costs — otherwise taking it every time is simply the
  // correct strategy and the leaderboard stops measuring anything.
  gameHintPenaltySec: 30,
  // How many artworks a campaign needs before it can be played. With only
  // a handful in the mosaic, almost everything on screen belongs to the
  // target and the hunt is over before it starts. start_game enforces it
  // in the database too. 0 turns the check off.
  gameMinArtworks: 10,
  // Costs one interval a second and a few hundred bytes of localStorage.
  // On by default: a freeze leaves no evidence any other way.
  freezeWatchdog: true,
  // How fast the artist icons drift around the network page, as a multiple
  // of the original speed (one turn every 5 minutes). 3 = a turn every 100
  // seconds, which is what the page ships with.
  networkOrbitSpeed: 3,
  // Plan limits the admin Usage tiles show a percentage of. Supabase Pro:
  // 8 GB of database disk per project, 100 GB of Storage. Options rather
  // than constants so changing plan does not need a deploy.
  dbLimitGb: 8,
  storageLimitGb: 100,
  // Web push (js/push.js, sw.js, supabase_push.sql). Off until an admin
  // pastes the VAPID public key and the Edge Function URL — both are public
  // values, so they live here rather than in the repo, and rotating a key
  // needs no deploy. The matching PRIVATE key is a Supabase secret and is
  // never in this repository (CLAUDE.md §3).
  pushEnabled: false,
  pushPublicKey: '',
  pushEndpoint: '',
});
const SITE_SETTINGS_TTL_MS = 60 * 1000;
const SITE_SETTINGS_CACHE_KEY = 'weavo.siteSettings';
let siteSettingsPromise = null;

function readSiteSettingsCache() {
  try {
    const raw = sessionStorage.getItem(SITE_SETTINGS_CACHE_KEY);
    if (!raw) return null;
    const { at, settings } = JSON.parse(raw);
    if (!settings || typeof settings !== 'object' || Date.now() - at > SITE_SETTINGS_TTL_MS) return null;
    return settings;
  } catch (e) { return null; }
}
function writeSiteSettingsCache(stored) {
  try { sessionStorage.setItem(SITE_SETTINGS_CACHE_KEY, JSON.stringify({ at: Date.now(), settings: stored })); } catch (e) { /* private mode etc. — just no cache */ }
}
// Make this tab answer getSiteSettings() from `settings` (the stored,
// non-default keys) right away — admin.js calls this after a save.
function setSiteSettingsCache(settings) {
  const stored = (settings && typeof settings === 'object') ? settings : {};
  writeSiteSettingsCache(stored);
  siteSettingsPromise = Promise.resolve({ ...SITE_SETTING_DEFAULTS, ...stored });
}
// Resolves to { ...SITE_SETTING_DEFAULTS, ...stored }. Never rejects: if the
// table doesn't exist yet (SQL not applied — PGRST205 / 42P01) or the request
// fails, the defaults apply and the next call tries again.
function getSiteSettings() {
  if (!siteSettingsPromise) {
    siteSettingsPromise = (async () => {
      const cached = readSiteSettingsCache();
      if (cached) return { ...SITE_SETTING_DEFAULTS, ...cached };
      const { data, error } = await sb.from('site_settings').select('settings').eq('id', true).maybeSingle();
      if (error) {
        if (error.code !== 'PGRST205' && error.code !== '42P01') console.error('load site_settings error:', error);
        siteSettingsPromise = null;
        return { ...SITE_SETTING_DEFAULTS };
      }
      const stored = (data && data.settings && typeof data.settings === 'object') ? data.settings : {};
      writeSiteSettingsCache(stored);
      return { ...SITE_SETTING_DEFAULTS, ...stored };
    })();
  }
  return siteSettingsPromise;
}

// ---------- game entry points ----------
// The nav link and the home/campaign banners are static markup on every
// page, so they would still be there after an admin turns the game off.
// One settings read (already cached per page) hides them all. Hiding is the
// right default: a link that leads to "not available" is worse than no link.
(function hideGameLinksWhenOff() {
  const links = document.querySelectorAll('[data-game-link]');
  if (!links.length) return;
  getSiteSettings().then(s => {
    if (s.gameEnabled === false) for (const el of links) el.style.display = 'none';
  }).catch(() => {});
})();

function routeParam(prefix, legacyQueryKey) {
  const parts = location.pathname.split('/').filter(Boolean);
  const idx = parts.indexOf(prefix);
  if (idx !== -1 && parts.length > idx + 1) return decodeURIComponent(parts[idx + 1]);
  return legacyQueryKey ? new URLSearchParams(location.search).get(legacyQueryKey) : null;
}

async function uploadImage(file) {
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
  const path = `${me.id}/${Date.now()}.${ext}`;
  // Upload paths are timestamped and never reused for different content, so
  // this can be cached as effectively permanent — the 1hr default forced
  // every image to be re-fetched from Supabase every hour for every visitor.
  const { error } = await sb.storage.from('artwork').upload(path, file, { cacheControl: '31536000' });
  if (error) { console.error('uploadImage error:', error); toast(tr('imageUploadFailed', { msg: error.message })); return null; }
  return sb.storage.from('artwork').getPublicUrl(path).data.publicUrl;
}

// Shrinks an image file so its longer side is ≤ maxDim (PNG, so a logo's
// transparency survives); a file already that small is returned untouched.
// Resolves to the original on any decode failure — never blocks an upload.
async function shrinkImageFile(file, maxDim) {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await loadImageEl(objectUrl);
    const w0 = img.naturalWidth, h0 = img.naturalHeight;
    if (!w0 || !h0 || Math.max(w0, h0) <= maxDim) return file;
    const scale = maxDim / Math.max(w0, h0);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w0 * scale)); canvas.height = Math.max(1, Math.round(h0 * scale));
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    return blob ? new File([blob], file.name.replace(/\.[^.]+$/, '') + '.png', { type: 'image/png' }) : file;
  } catch (e) {
    console.error('shrinkImageFile failed:', e);
    return file;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

// Downscaled copies of an uploaded artwork, both made in the browser from a
// single decode of the file:
//  • thumb — longer side ≤ THUMB_MAX_DIM px, JPEG — for every place a piece
//    shows small (grid cells once zoomed in, lists, profile, previews). An
//    original that is already that small needs none: its own URL is used.
//  • micro — a MICRO_THUMB_PX-square, centre-cropped JPEG as a data URI
//    (~0.5 KB), stored in mosaic_submissions.micro_thumb, so the campaign
//    canvas can paint every filled cell as a tiny picture at any zoom with
//    no image request per piece (supabase_mosaic_micro_thumbs.sql).
// Any failure yields nulls — an upload is never blocked by its derivatives.
const THUMB_MAX_DIM = 480;
const MICRO_THUMB_PX = 16;
function artworkDerivativesFromImage(img) {
  const w0 = img.naturalWidth, h0 = img.naturalHeight;
  const out = { thumbBlob: null, thumbNeeded: Math.max(w0, h0) > THUMB_MAX_DIM, micro: null };
  const micro = document.createElement('canvas');
  micro.width = MICRO_THUMB_PX; micro.height = MICRO_THUMB_PX;
  const side = Math.min(w0, h0); // centre square crop, like background-size: cover
  micro.getContext('2d').drawImage(img, (w0 - side) / 2, (h0 - side) / 2, side, side, 0, 0, MICRO_THUMB_PX, MICRO_THUMB_PX);
  out.micro = micro.toDataURL('image/jpeg', 0.65);
  if (!out.thumbNeeded) return Promise.resolve(out);
  const scale = THUMB_MAX_DIM / Math.max(w0, h0);
  const w = Math.max(1, Math.round(w0 * scale)), h = Math.max(1, Math.round(h0 * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(img, 0, 0, w, h);
  return new Promise(resolve => canvas.toBlob(blob => { out.thumbBlob = blob; resolve(out); }, 'image/jpeg', 0.82));
}
function makeArtworkDerivatives(file) {
  const objectUrl = URL.createObjectURL(file);
  return loadImageEl(objectUrl).then(artworkDerivativesFromImage)
    .catch(() => ({ thumbBlob: null, thumbNeeded: true, micro: null }))
    .finally(() => URL.revokeObjectURL(objectUrl));
}
// Thumbnails live in the same `artwork` bucket under thumb/<owner>/ — the
// owner's folder, so account deletion cleans them up with the originals.
async function uploadThumbBlob(blob, ownerId) {
  const path = `thumb/${ownerId}/${Date.now()}.jpg`;
  const { error } = await sb.storage.from('artwork').upload(path, blob, { cacheControl: '31536000', contentType: 'image/jpeg' });
  if (error) { console.error('thumbnail upload error:', error); return null; }
  return sb.storage.from('artwork').getPublicUrl(path).data.publicUrl;
}

// Uploads the full-resolution artwork file (image_url) plus its derivatives:
// thumb_url (the original's own URL when it is already ≤ THUMB_MAX_DIM, a
// separate upload otherwise) and the micro thumbnail data URI. A derivative
// failure still returns the full-res url — the artwork itself shouldn't be
// blocked by it; the admin page lists such pieces and can rebuild them.
async function uploadArtworkImage(file) {
  const url = await uploadImage(file);
  if (!url) return { url: null, thumbUrl: null, microThumb: null };
  const d = await makeArtworkDerivatives(file);
  if (!d.thumbNeeded) return { url, thumbUrl: url, microThumb: d.micro };
  if (!d.thumbBlob) return { url, thumbUrl: null, microThumb: d.micro };
  return { url, thumbUrl: await uploadThumbBlob(d.thumbBlob, me.id), microThumb: d.micro };
}

// ---------- liked artwork pool (mosaic_submission_likes) ----------
// A user's flat liked pool — powers the profile page's own Liked grid
// (js/profile-view.js). There used to be a separate "save"/"Collect" table
// backing this; it was merged into likes so liking a piece is the only way
// a piece a user doesn't own gets into this pool.
async function fetchLikedWeavoArt(userId) {
  const { data, error } = await sb.from('mosaic_submission_likes')
    .select('created_at,mosaic_submissions(id,pixel_id,project_id,image_url,thumb_url,art_title,art_material,art_completed_date,art_description,art_link,author_id,author_name,author_avatar_url)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) { console.error('load liked weavo art error:', error); return []; }
  return (data || []).map(row => row.mosaic_submissions).filter(Boolean);
}

// ---------- artwork pieces (supabase_mosaic_pieces.sql) ----------
// An artwork is cut into n×n pieces in the browser; each piece becomes a
// row of its own (parent_id → the artwork) with its average colour and a
// 16px micro thumbnail, and it is the PIECES that get matched into cells.
// The cut keeps the artwork's full extent: a non-square artwork gives
// non-square pieces, drawn stretched into the square cell — the same
// stretch a cell thumbnail gets from background-size (pieceCropStyle).
// Regions of a PNG that are (almost) fully transparent are left out.
function artworkPiecesFromImage(img, n) {
  const w0 = img.naturalWidth, h0 = img.naturalHeight;
  const pieces = [];
  if (!w0 || !h0 || !(n >= 2)) return pieces;
  const SAMPLE = 24;
  const sample = document.createElement('canvas'); sample.width = SAMPLE; sample.height = SAMPLE;
  const sctx = sample.getContext('2d');
  const micro = document.createElement('canvas'); micro.width = MICRO_THUMB_PX; micro.height = MICRO_THUMB_PX;
  const mctx = micro.getContext('2d');
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const sx = (col * w0) / n, sy = (row * h0) / n, sw = w0 / n, sh = h0 / n;
      sctx.clearRect(0, 0, SAMPLE, SAMPLE);
      sctx.drawImage(img, sx, sy, sw, sh, 0, 0, SAMPLE, SAMPLE);
      const d = sctx.getImageData(0, 0, SAMPLE, SAMPLE).data;
      let r = 0, g = 0, b = 0, a = 0;
      for (let i = 0; i < d.length; i += 4) {
        const al = d[i + 3];
        if (al < 16) continue;
        r += d[i] * al; g += d[i + 1] * al; b += d[i + 2] * al; a += al;
      }
      if (a < 255 * SAMPLE * SAMPLE * 0.2) continue; // mostly transparent (PNG padding): not part of the artwork
      mctx.fillStyle = '#fff'; mctx.fillRect(0, 0, MICRO_THUMB_PX, MICRO_THUMB_PX); // JPEG has no alpha
      mctx.drawImage(img, sx, sy, sw, sh, 0, 0, MICRO_THUMB_PX, MICRO_THUMB_PX);
      pieces.push({ row, col, r: Math.round(r / a), g: Math.round(g / a), b: Math.round(b / a), micro: micro.toDataURL('image/jpeg', 0.65) });
    }
  }
  return pieces;
}
function pieceGridOf(settings) {
  const n = Math.round(Number(settings && settings.pieceGrid));
  return Number.isInteger(n) && n >= 2 && n <= 12 ? n : 7;
}
// Cuts (or re-cuts) an artwork: n from the pieceGrid site option unless
// given. `img` must be same-origin (the upload preview, or /img/) so the
// canvas stays readable. Resolves {count}, {missing:true} while
// supabase_mosaic_pieces.sql isn't applied (the artwork then stays whole
// and is matched as before), or {error}.
async function makeArtworkPieces(parentId, img, n) {
  const grid = n || pieceGridOf(await getSiteSettings());
  const pieces = artworkPiecesFromImage(img, grid);
  if (!pieces.length) return { count: 0 };
  const { data, error } = await sb.rpc('set_submission_pieces', { p_parent_id: parentId, p_n: grid, p_pieces: pieces });
  if (error) {
    if (error.code === 'PGRST202' || error.code === '42883') return { missing: true };
    console.error('set_submission_pieces error:', error);
    return { error };
  }
  return { count: Number(data) || pieces.length };
}
// How much of a cut artwork sits in a campaign mosaic ("12/49 pieces").
async function fetchPieceUsage(parentId) {
  const { data, error } = await sb.from('mosaic_submissions').select('id,pixel_id,piece_n').eq('parent_id', parentId);
  if (error) { if (!isSchemaMismatchError(error)) console.error('load pieces error:', error); return null; }
  const total = (data || []).length;
  if (!total) return null;
  const placed = data.filter(p => p.pixel_id != null).length;
  return { placed, total, pct: Math.round((placed / total) * 100), n: data[0].piece_n };
}
// A user's own artworks, newest first — pieces excluded; asked again
// without the filter while supabase_mosaic_pieces.sql isn't applied
// (unknown column → schema mismatch). Shared by the profile grid and the
// collection picker.
const ARTWORK_ROW_COLS = 'id,pixel_id,project_id,image_url,thumb_url,art_title,art_material,art_completed_date,art_description,art_link,author_id,author_name,author_avatar_url,created_at';

// One artwork row, for a grid that lists many but opens one. Artwork grids
// normally select ARTWORK_ROW_COLS for the whole list so a click needs no
// request — but the home strip and the game list run to a few hundred rows
// on the two most-visited pages, and almost nobody clicks. Paying ~200
// bytes per row per visit to save a request for the rare click is the wrong
// trade there; one lookup on the click is ~1KB, cached per id.
const artworkRowCache = new Map();
function fetchArtworkRow(id) {
  const key = String(id);
  if (!artworkRowCache.has(key)) {
    artworkRowCache.set(key, (async () => {
      const { data, error } = await sb.from('mosaic_submissions')
        .select(ARTWORK_ROW_COLS).eq('id', id).maybeSingle();
      if (error) {
        console.error('load artwork row error:', error);
        artworkRowCache.delete(key);   // a network blip must not be cached as 'no such artwork'
        return null;
      }
      return data;
    })());
  }
  return artworkRowCache.get(key);
}

// Opens the artwork in the lightbox, falling back to its own page if the
// row can't be read or the page never loaded lightbox.js.
async function openArtworkById(id) {
  let row = null;
  try { row = await fetchArtworkRow(id); } catch (e) { console.error('open artwork error:', e); }
  if (row && typeof openLightbox === 'function') { openLightbox(row); return; }
  location.href = artworkUrl(id);
}

// Wires a card whose href already points at the artwork page: plain left
// clicks open the lightbox, everything else (middle click, Ctrl/Cmd, and
// crawlers) keeps the real indexable link.
function bindArtworkLightbox(el, id) {
  el.addEventListener('click', e => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    openArtworkById(id);
  });
}
async function fetchOwnArtworkRows(userId) {
  const q = withPieces => {
    let s = sb.from('mosaic_submissions').select(ARTWORK_ROW_COLS + (withPieces ? ',piece_n,home_project_id' : '')).eq('author_id', userId);
    if (withPieces) s = s.is('parent_id', null);
    return s.order('created_at', { ascending: false });
  };
  let res = await q(true);
  if (res.error && isSchemaMismatchError(res.error)) res = await q(false);
  return res;
}

// ---------- collectible artwork pool (liked ∪ own) ----------
// Everything a user can add to one of their Collections: their liked pool
// above, plus every piece they've authored themselves — a user's own
// artwork should always be addable to their own collections, whether or
// not they've separately liked it. Backs the collection detail page's
// add-artwork picker (js/collection.js's openAddArtworkModal).
async function fetchCollectibleWeavoArt(userId) {
  const [liked, { data: own, error: ownErr }] = await Promise.all([
    fetchLikedWeavoArt(userId),
    fetchOwnArtworkRows(userId), // artworks only — pieces are not collectible
  ]);
  if (ownErr) console.error('load own weavo art error:', ownErr);
  const byId = new Map(liked.map(sub => [sub.id, sub]));
  for (const sub of (own || [])) byId.set(sub.id, sub);
  return [...byId.values()];
}

// ---------- confirm dialog ----------
// `confirmText`, when given, gates the OK button behind an input field
// that must match it exactly — used for the highest-stakes destructive
// actions (e.g. deleting an account) where a plain OK/Cancel click is too
// easy to hit by accident.
function confirmDialog(message, { title = tr('areYouSure'), okLabel = tr('continueLabel'), confirmText = null } = {}) {
  return new Promise(resolve => {
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-message').textContent = message;
    document.getElementById('confirm-ok').textContent = okLabel;
    const modal = document.getElementById('confirm-modal');
    const okBtn = document.getElementById('confirm-ok');
    const cancelBtn = document.getElementById('confirm-cancel');
    const inputWrap = document.getElementById('confirm-input-wrap');
    const input = document.getElementById('confirm-input');
    const finish = result => { modal.classList.remove('open'); input.oninput = null; resolve(result); };
    if (confirmText) {
      inputWrap.style.display = '';
      input.value = '';
      input.placeholder = confirmText;
      okBtn.disabled = true;
      input.oninput = () => { okBtn.disabled = input.value !== confirmText; };
    } else {
      inputWrap.style.display = 'none';
      input.oninput = null;
      okBtn.disabled = false;
    }
    okBtn.onclick = () => { if (!okBtn.disabled) finish(true); };
    cancelBtn.onclick = () => finish(false);
    modal.onclick = e => { if (e.target === e.currentTarget) finish(false); };
    modal.classList.add('open');
    if (confirmText) setTimeout(() => input.focus(), 30);
  });
}

// ---------- report modal (posts, comments, accounts) ----------
// Built once here — same rationale as the lightbox's add-to-exhibition
// dropdown (js/lightbox.js) — rather than repeated in every page's static
// HTML, since the markup is identical everywhere a report button can appear
// (lightbox actions, comment rows, profile header). `targetType` matches
// public.reports' check constraint: 'submission' | 'comment' | 'profile'.
const REPORT_REASON_KEYS = ['spam', 'harassment', 'hate_speech', 'nudity', 'misinformation', 'other'];
let reportModalEl = null;
function buildReportModal() {
  if (reportModalEl) return reportModalEl;
  const wrap = document.createElement('div');
  wrap.className = 'modal-overlay';
  wrap.id = 'report-modal';
  wrap.innerHTML = `
    <div class="modal-panel" id="report-dialog">
      <h3 id="report-title"></h3>
      <div class="field">
        <label for="report-reason" id="report-reason-label"></label>
        <select id="report-reason"></select>
      </div>
      <div class="field">
        <label for="report-details" id="report-details-label"></label>
        <textarea id="report-details" maxlength="1000" rows="3"></textarea>
      </div>
      <div class="modal-actions">
        <button type="button" id="report-cancel" class="btn-cancel"></button>
        <button type="button" id="report-submit" class="btn-primary"></button>
      </div>
    </div>`;
  document.body.appendChild(wrap);
  const reasonSelect = wrap.querySelector('#report-reason');
  for (const key of REPORT_REASON_KEYS) {
    const opt = document.createElement('option');
    opt.value = key; opt.textContent = tr(`reportReason_${key}`);
    reasonSelect.appendChild(opt);
  }
  const close = () => wrap.classList.remove('open');
  wrap.querySelector('#report-cancel').onclick = close;
  wrap.onclick = e => { if (e.target === e.currentTarget) close(); };
  reportModalEl = wrap;
  return wrap;
}
function openReportModal(targetType, targetId) {
  if (!me.id) { openAuthModal(); return; }
  const wrap = buildReportModal();
  wrap.querySelector('#report-title').textContent = tr(`reportTitle_${targetType}`);
  wrap.querySelector('#report-reason-label').textContent = tr('reportReasonLabel');
  wrap.querySelector('#report-reason').value = REPORT_REASON_KEYS[0];
  wrap.querySelector('#report-details-label').innerHTML = '';
  wrap.querySelector('#report-details-label').append(
    tr('reportDetailsLabel') + ' ', Object.assign(document.createElement('span'), { className: 'field-hint', textContent: tr('optionalHint') })
  );
  const details = wrap.querySelector('#report-details');
  details.value = '';
  details.placeholder = tr('reportDetailsPlaceholder');
  wrap.querySelector('#report-cancel').textContent = tr('cancelLabel');
  const submitBtn = wrap.querySelector('#report-submit');
  submitBtn.textContent = tr('reportSubmitLabel');
  submitBtn.disabled = false;
  submitBtn.onclick = async () => {
    submitBtn.disabled = true;
    const reason = wrap.querySelector('#report-reason').value;
    const { error } = await sb.from('reports').insert({
      reporter_id: me.id, target_type: targetType, target_id: String(targetId),
      reason, details: details.value.trim() || null,
    });
    submitBtn.disabled = false;
    if (error) {
      wrap.classList.remove('open');
      toast(error.code === '23505' ? tr('alreadyReportedToast') : tr('couldNotSubmitReport'));
      if (error.code !== '23505') console.error('submit report error:', error);
      return;
    }
    wrap.classList.remove('open');
    toast(tr('reportSubmittedToast'));
  };
  wrap.classList.add('open');
}

// ---------- user blocking (Apple App Store 1.2 UGC requirement) ----------
// myBlockedIds is populated once per sign-in (see loadMyProfile in auth.js)
// rather than queried per-render, since it's read from a lot of places:
// three Block/Unblock buttons (lightbox artwork actions, lightbox comment
// rows, profile header) plus the client-side filters that keep a blocked
// user's comments/artwork/profile out of the comment list, recent-artworks
// feed, artist directory, and network graphs (never the project mosaic's
// cells themselves — a placed piece stays put either way).
let myBlockedIds = new Set();
function isUserBlocked(userId) { return myBlockedIds.has(userId); }

// Shared by every surface that offers a block/unblock control — same
// rationale as toggleUserFollow. `btn` is only used to show a disabled
// state while the request is in flight; callers re-render their own label
// off isUserBlocked() once this resolves.
async function toggleUserBlock(targetId, btn) {
  if (!me.id) { openAuthModal(); return; }
  const wasBlocked = isUserBlocked(targetId);
  if (!wasBlocked) {
    const proceed = await confirmDialog(tr('blockUserConfirmMessage'), { title: tr('blockUserConfirmTitle'), okLabel: tr('blockUserConfirmOkLabel') });
    if (!proceed) return;
  }
  if (btn) btn.disabled = true;
  const { error } = wasBlocked
    ? await sb.from('user_blocks').delete().eq('blocker_id', me.id).eq('blocked_id', targetId)
    : await sb.from('user_blocks').insert({ blocker_id: me.id, blocked_id: targetId });
  if (btn) btn.disabled = false;
  if (error) { console.error('toggle block error:', error); toast(tr('couldNotUpdateBlockUser')); return; }
  if (wasBlocked) myBlockedIds.delete(targetId); else myBlockedIds.add(targetId);
  toast(wasBlocked ? tr('userUnblockedToast') : tr('userBlockedToast'));
}

// ---------- freeze the page behind an open dialog ----------
// base.css locks .main-scroll with :has(), which covers the pages where that
// element is the scroller. On the rest the DOCUMENT scrolls, and there
// overflow:hidden would lose the reader's place — iOS snaps to the top and
// stays there after the dialog closes. So the position is saved, the body is
// pinned where it was, and the position restored on close.
//
// A MutationObserver rather than a call at every classList.add('open'):
// dialogs are opened from a dozen places across auth.js, project.js,
// profile-view.js, collection.js, lightbox.js and admin.js, and one of them
// would eventually be missed. The observer's records already arrive batched
// once per task, so no extra throttling is needed — and none that depends on
// requestAnimationFrame, which does not run while the tab is hidden.
(function () {
  let lockedAt = null;
  function apply() {
    const open = !!document.querySelector('.modal-overlay.open');
    if (open === (lockedAt !== null)) return;
    if (open) {
      lockedAt = document.scrollingElement.scrollTop;
      document.body.style.top = `-${lockedAt}px`;
      document.body.classList.add('modal-open');
    } else {
      const back = lockedAt;
      lockedAt = null;
      document.body.classList.remove('modal-open');
      document.body.style.top = '';
      document.scrollingElement.scrollTop = back;
    }
  }
  new MutationObserver(apply).observe(document.documentElement, {
    subtree: true, attributes: true, attributeFilter: ['class'],
  });
})();


// ---------- freeze watchdog ----------
// A page that locks up — no clicks, no text selection, F5 ignored, while
// other tabs stay fine — is one renderer whose main thread stopped coming
// back. Nothing can report that from inside: by the time it happens there
// is no thread left to run the reporter. So the evidence is written BEFORE
// the stall. A heartbeat drops a small snapshot once a second (what page,
// what the visitor last did, what heavy work was last entered, how big the
// JS heap is, the worst long task seen); whatever the final snapshot says
// is what the page was doing as it died, and the next load turns an
// abandoned snapshot into a report.
//
// Per tab, not per browser: a snapshot key carries a tab id and is refreshed
// every second, so a snapshot nobody has touched for a minute belongs to a
// tab that is gone — and a second tab open right now is never mistaken for
// a crash. A clean exit deletes its own key, so only hard endings are left.
//
// Read the reports with weavoFreezeReport() in the console. Turn the whole
// thing off in admin → site options ('freezeWatchdog').
const WD_LIVE = 'weavo.wd.live.';
const WD_REPORTS = 'weavo.wd.reports';
// Longer than a browser throttles a background tab (intervals there are
// clamped to about a minute), so a tab someone left open in the background
// is never mistaken for one that died.
const WD_DEAD_AFTER = 180000;
const WD_STALL_MS = 3000;         // a heartbeat this late means the thread was blocked

// Breadcrumb: call at the start of work heavy enough to be worth suspecting.
// Kept in memory only — the heartbeat is what writes it out.
let wdMark = '';
function weavoMark(label) { wdMark = label; }

function weavoFreezeReport() {
  try { return JSON.parse(localStorage.getItem(WD_REPORTS) || '[]'); }
  catch (e) { return []; }
}

(function () {
  let enabled = true;             // runs from the first line; the option can stop it
  const tabId = Math.random().toString(36).slice(2, 10) + '-' + Date.now().toString(36);
  const key = WD_LIVE + tabId;
  let lastAction = '';
  let worstTask = 0;
  let beat = Date.now();
  // Same throttle, other direction: a hidden tab misses beats by design, and
  // that must not be logged as the page freezing.
  let sawHidden = document.hidden;
  let timer = 0;

  const store = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
  const drop = k => { try { localStorage.removeItem(k); } catch (e) {} };

  // ---- turn abandoned snapshots into reports (runs once, at load) ----
  function collect() {
    const keys = [];
    try { for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i)); }
    catch (e) { return; }
    const now = Date.now();
    const reports = weavoFreezeReport();
    let found = 0;
    for (const k of keys) {
      if (!k || k.indexOf(WD_LIVE) !== 0 || k === key) continue;
      let snap = null;
      try { snap = JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) {}
      if (!snap || !snap.t) { drop(k); continue; }
      if (now - snap.t < WD_DEAD_AFTER) continue;   // another tab, still alive
      drop(k);
      snap.endedHard = true;
      reports.push(snap);
      found++;
    }
    if (found) {
      store(WD_REPORTS, JSON.stringify(reports.slice(-20)));
      console.warn('weavo: a page ended without closing cleanly — weavoFreezeReport()', reports.slice(-found));
    }
  }

  // ---- the heartbeat ----
  function snapshot(extra) {
    const mem = performance.memory;
    const snap = {
      t: Date.now(),
      page: location.pathname,
      did: lastAction,
      mark: wdMark,
      heapMB: mem ? Math.round(mem.usedJSHeapSize / 1048576) : null,
      limitMB: mem ? Math.round(mem.jsHeapSizeLimit / 1048576) : null,
      worstTaskMs: Math.round(worstTask),
      nodes: document.getElementsByTagName('*').length,
      hidden: document.hidden,
      ua: navigator.userAgent.slice(0, 120),
    };
    if (extra) Object.assign(snap, extra);
    store(key, JSON.stringify(snap));
    return snap;
  }

  function tick() {
    const now = Date.now();
    const late = now - beat - 1000;
    beat = now;
    const wasHidden = sawHidden || document.hidden;
    sawHidden = document.hidden;
    // A stall the page RECOVERED from is worth keeping on its own: it is the
    // same fault, just shorter, and it comes with an after-the-fact heap
    // reading the fatal case never gets to write.
    if (late > WD_STALL_MS && !wasHidden) {
      const reports = weavoFreezeReport();
      const snap = snapshot({ stalledMs: late, recovered: true });
      reports.push(snap);
      store(WD_REPORTS, JSON.stringify(reports.slice(-20)));
      console.warn('weavo: main thread was blocked for ' + late + 'ms', snap);
    } else {
      snapshot(null);
    }
    worstTask = 0;
  }

  // ---- what the visitor last did (capture phase: before any handler) ----
  function describe(el) {
    if (!el || !el.tagName) return '';
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    else if (el.className && typeof el.className === 'string') s += '.' + el.className.trim().split(/\s+/)[0];
    return s.slice(0, 60);
  }
  addEventListener('visibilitychange', () => { if (document.hidden) sawHidden = true; });

  for (const type of ['pointerdown', 'keydown', 'wheel']) {
    addEventListener(type, e => {
      lastAction = type + ' ' + (type === 'keydown' ? e.key : describe(e.target));
    }, { capture: true, passive: true });
  }

  function start() {
    collect();
    snapshot(null);
    clearInterval(timer);
    timer = setInterval(tick, 1000);
    try {
      new PerformanceObserver(list => {
        for (const e of list.getEntries()) if (e.duration > worstTask) worstTask = e.duration;
      }).observe({ entryTypes: ['longtask'] });
    } catch (e) {}
    // A clean exit removes its own snapshot, so anything left behind really
    // was an ending the page had no say in.
    addEventListener('pagehide', () => drop(key));
  }
  function stop() { clearInterval(timer); timer = 0; drop(key); }

  start();
  // The option arrives late (one request, 60s cache) — until then the watchdog
  // is already running, which is the point: the first seconds are evidence too.
  if (typeof getSiteSettings === 'function') {
    getSiteSettings().then(s => {
      enabled = s.freezeWatchdog !== false;
      if (!enabled) stop();
    }).catch(() => {});
  }
})();

// ---------- "Back" links on standalone pages ----------
// The artwork / profile / exhibition pages are shareable, indexable URLs, so
// their back link needs a real href for anyone who arrived from outside
// (search, a shared link) — that is the artwork's campaign, or the campaign
// list. But when the visitor came from another Weavo page in this tab, back
// means the page they were actually on: the home page, the artwork grid they
// were scrolling halfway down, the profile they clicked from. Before
// 2026-09-12 the artwork page always went to the campaign, so opening an
// artwork from the home page had no way back to it.
//
// history.length > 1 matters for a link opened in a NEW TAB: the referrer is
// set there too, but there is nothing behind the current entry, so
// history.back() would leave the visitor stuck on the page.
function cameFromThisSite() {
  if (history.length <= 1) return false;
  try { return !!document.referrer && new URL(document.referrer).origin === location.origin; }
  catch (e) { return false; }
}
// onLeave runs only when the click really takes the page away — a
// ctrl/cmd-click opens a new tab and must leave this page (and its running
// graph, timers) alone.
function setupBackLink(el, onLeave) {
  if (!el) return;
  el.addEventListener('click', e => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (typeof onLeave === 'function') onLeave();
    if (!cameFromThisSite()) return; // follow the href
    e.preventDefault();
    history.back();
  });
}

// ---------- reusable drag/drop image picker ----------
const MAX_IMG_BYTES = 8 * 1024 * 1024;
function setupPicker(containerId) {
  const el = document.getElementById(containerId);
  const input = el.querySelector('.img-input');
  const preview = el.querySelector('.img-preview');
  const placeholder = el.querySelector('.img-placeholder');
  function show(src) {
    preview.src = src;
    preview.style.display = 'block';
    placeholder.style.display = 'none';
    el.classList.add('has-img');
  }
  function loadFile(file) {
    if (!file.type.startsWith('image/')) return;
    if (file.size > MAX_IMG_BYTES) { toast(tr('imageTooLarge')); return; }
    el._file = file;
    el._removed = false;
    const reader = new FileReader();
    reader.onload = ev => show(ev.target.result);
    reader.readAsDataURL(file);
  }
  function reset(removed) {
    el._file = null;
    el._removed = !!removed;
    input.value = '';
    preview.style.display = 'none';
    preview.src = '';
    placeholder.style.display = '';
    el.classList.remove('has-img');
  }
  input.addEventListener('change', e => { const f = e.target.files[0]; if (f) loadFile(f); });
  el.addEventListener('dragover', e => { e.preventDefault(); el.classList.add('drag'); });
  el.addEventListener('dragleave', () => el.classList.remove('drag'));
  el.addEventListener('drop', e => {
    e.preventDefault(); el.classList.remove('drag');
    const f = e.dataTransfer.files[0]; if (f) loadFile(f);
  });
  el.querySelector('.img-remove').addEventListener('click', e => { e.stopPropagation(); reset(true); });
  return {
    getFile: () => el._file,
    wasRemoved: () => !!el._removed,
    getPreviewEl: () => preview,
    // Shows a pre-existing (already-uploaded) image without marking it as a pending file to upload.
    setExisting: url => { el._file = null; el._removed = false; url ? show(url) : reset(false); },
    reset: () => reset(false)
  };
}

// Every avatar (artwork byline, comment author, artist card) links to that
// user's profile page. `sizeClass` adds a modifier (e.g. 'lb-artist-avatar')
// for larger variants.
function miniAvatarEl(name, avatarUrl, userId, sizeClass) {
  const link = document.createElement('a');
  link.href = profileUrl(userId);
  link.className = sizeClass ? `mini-avatar ${sizeClass}` : 'mini-avatar';
  link.title = name || '';
  if (avatarUrl) {
    const img = document.createElement('img'); img.src = cdnUrl(avatarUrl);
    img.alt = name ? tr('artistAvatarAlt', { name }) : '';
    link.appendChild(img);
  } else {
    link.textContent = (name || '?').trim().charAt(0).toUpperCase() || '?';
  }
  return link;
}

// ---------- user-to-user follows ----------
// Follows are asymmetric — shared by the profile page's own Follow
// button/counts (js/profile-view.js) and the lightbox's artist-card follow
// button (js/lightbox.js's setupLightboxArtistFollow), since both let you
// follow/unfollow a person, just from different surfaces. Backed by the
// user_saves table (saver_id/saved_id columns) under the hood.
async function fetchFollowCounts(userId) {
  const [{ count: following, error: followingErr }, { count: followers, error: followersErr }] = await Promise.all([
    sb.from('user_saves').select('*', { count: 'exact', head: true }).eq('saver_id', userId),
    sb.from('user_saves').select('*', { count: 'exact', head: true }).eq('saved_id', userId),
  ]);
  if (followingErr) console.error('load follow counts (following) error:', followingErr);
  if (followersErr) console.error('load follow counts (followers) error:', followersErr);
  return { following: following || 0, followers: followers || 0 };
}
async function fetchIsFollowing(viewerId, targetId) {
  const { data, error } = await sb.from('user_saves').select('saver_id')
    .eq('saver_id', viewerId).eq('saved_id', targetId).maybeSingle();
  if (error) console.error('load is-following error:', error);
  return !!data;
}
// Updates #profileFollowersN in place if present (the profile page's own
// counts row) — a no-op elsewhere (e.g. the lightbox's artist-card button),
// where that element doesn't exist on the page at all.
async function toggleUserFollow(targetId, btn) {
  if (!me.id) { openAuthModal(); return; }
  const wasFollowing = btn.classList.contains('following');
  btn.disabled = true;
  const { error } = wasFollowing
    ? await sb.from('user_saves').delete().eq('saver_id', me.id).eq('saved_id', targetId)
    : await sb.from('user_saves').insert({ saver_id: me.id, saved_id: targetId });
  btn.disabled = false;
  if (error) { console.error('toggle follow error:', error); toast(tr('couldNotUpdateFollowUser')); return; }
  btn.classList.toggle('following', !wasFollowing);
  btn.textContent = !wasFollowing ? tr('followingLabel') : tr('followLabel');
  const followersEl = document.getElementById('profileFollowersN');
  if (followersEl) followersEl.textContent = Number(followersEl.textContent || 0) + (wasFollowing ? -1 : 1);
}

// Keys must match what the profile editor already writes into
// profiles.links (jsonb). Labels are the same in both languages.
const LINK_PLATFORMS = [
  { key: 'instagram', label: 'Instagram' },
  { key: 'twitter',   label: 'Twitter / X' },
  { key: 'tiktok',    label: 'TikTok' },
  { key: 'website',   label: 'Website' },
];

// Options for the profile editor's disability multi-select — a custom
// checkbox dropdown (see buildEditProfileDisabilityOptions in auth.js), not
// a native <select multiple>, so picking an option is a plain left click
// rather than needing ctrl/cmd-click. DISABILITY_STANDALONE_KEYS render
// above all groups with no group header; the rest are grouped into
// labeled sections. Stored in profiles.disabilities (text[]) as these
// stable keys — never the display label — so a language switch doesn't
// fork a user's saved values. Labels are looked up per-language via
// disabilityLabel()/disabilityGroupLabel() (see js/i18n/{en,ko}.js).
// DISABILITY_EXCLUSIVE_KEYS are mutually exclusive with every other option
// (and with each other) — picking one clears the rest.
const DISABILITY_STANDALONE_KEYS = ['no_disability'];
const DISABILITY_GROUPS = [
  { key: 'physical', keys: ['mobility', 'dexterity', 'limb_difference'] },
  { key: 'vision', keys: ['blind', 'low_vision', 'color_blindness'] },
  { key: 'hearing', keys: ['deaf', 'hard_of_hearing'] },
  { key: 'neurodivergent_learning', keys: ['adhd', 'autism', 'learning_disability', 'tourettes_tic', 'intellectual_developmental'] },
  { key: 'mental_health', keys: ['anxiety', 'depression', 'mental_health_other'] },
  { key: 'chronic_health', keys: ['chronic_illness', 'chronic_pain', 'fatigue_condition'] },
  { key: 'speech_communication', keys: ['speech', 'nonverbal_communication'] },
  { key: 'other', keys: ['other', 'prefer_not_to_say'] },
];
const DISABILITY_KEYS = [...DISABILITY_STANDALONE_KEYS, ...DISABILITY_GROUPS.flatMap(g => g.keys)];
const DISABILITY_EXCLUSIVE_KEYS = ['no_disability', 'prefer_not_to_say'];

// Points the lang-toggle buttons at the sibling page under the other
// language directory (same path + query), and marks the current one active.
function wireLangToggle() {
  const other = CURRENT_LANG === 'ko' ? 'en' : 'ko';
  document.querySelectorAll('.lang-btn').forEach(btn => {
    const isActive = btn.dataset.lang === CURRENT_LANG;
    btn.classList.toggle('active', isActive);
    if (!isActive) {
      btn.onclick = () => {
        localStorage.setItem('weavoLang', btn.dataset.lang);
        // Also mirrored into a cookie (not just localStorage, which the
        // server can't read) so functions/index.js's "/" language redirect
        // honors an explicit past choice instead of falling back to
        // Accept-Language on every fresh visit to the bare domain root.
        document.cookie = `weavoLang=${btn.dataset.lang}; path=/; max-age=31536000; samesite=lax`;
        location.href = location.pathname.replace(`/${CURRENT_LANG}/`, `/${btn.dataset.lang}/`) + location.search;
      };
    }
  });
}

// ---------- mobile fullscreen popups (see .mfs-* in css/base.css) ----------
// Narrow screens only: lets a surface break out into a fixed, chrome-free
// full-viewport overlay with a floating corner button. Used two ways — a
// whole standalone page via <body data-mobile-fs> (Projects, Network), and
// an in-page section that expands on demand via .mfs-panel (the profile
// page's Projects / Network sections), where panning the graph or scrolling
// the grid inside a short in-page panel is fiddly on a phone.
const MFS_MOBILE_MQ = window.matchMedia('(max-width: 640px)');

function mfsCornerBtn(glyph, onClick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'mfs-close-btn';
  btn.setAttribute('aria-label', tr('mfsClose'));
  btn.textContent = glyph;
  btn.addEventListener('click', onClick);
  return btn;
}

// Wires a .mfs-panel: injects the "expand" button (shown only on mobile via
// CSS) that pops the panel fullscreen, plus the "×" that collapses it back.
// opts.label — expand button text (defaults to tr('mfsExpand')).
// opts.onEnter / opts.onExit — run one frame after the class toggles, once
// layout has settled (the graph panel uses this to re-fit to the new size).
function initMfsPanel(panel, opts = {}) {
  if (!panel || panel.dataset.mfsInit) return;
  panel.dataset.mfsInit = '1';

  const expand = document.createElement('button');
  expand.type = 'button';
  expand.className = 'mfs-expand-btn';
  expand.textContent = opts.label || tr('mfsExpand');
  const close = mfsCornerBtn('✕', () => setOpen(false));

  const label = panel.querySelector('.section-label, .profile-section-head');
  if (label) label.insertAdjacentElement('afterend', expand);
  else panel.prepend(expand);
  panel.appendChild(close);

  function setOpen(open) {
    panel.classList.toggle('mfs-open', open);
    document.body.classList.toggle('mfs-lock', open);
    requestAnimationFrame(() => { (open ? opts.onEnter : opts.onExit)?.(); });
  }
  expand.addEventListener('click', () => setOpen(true));
  // Rotating back to a wide viewport while open — drop back inline so the
  // fixed overlay doesn't get stranded on top of the desktop layout.
  MFS_MOBILE_MQ.addEventListener('change', e => { if (!e.matches) setOpen(false); });
  addEventListener('keydown', e => {
    if (e.key === 'Escape' && panel.classList.contains('mfs-open')) setOpen(false);
  });
}

// <body data-mobile-fs>: the standalone Projects / Network pages. On mobile
// the page chrome is hidden by CSS; add the floating "back" control that
// returns wherever the user came from.
if (document.body.hasAttribute('data-mobile-fs')) {
  const back = mfsCornerBtn('←', () => {
    if (history.length > 1) history.back();
    else location.href = `/${CURRENT_LANG}/`;
  });
  back.classList.add('mfs-back-btn');
  document.body.appendChild(back);
}

// ---------- "what is this?" info popup ----------
// The Network / Exhibitions explainers were lifted off the landing page onto
// the surfaces they describe. Any [data-info-open] control opens #info-modal;
// a backdrop click or a [data-info-close] control closes it. Escape is
// already handled by the generic .modal-overlay.open handler in auth.js.
(function wireInfoPopup() {
  const modal = document.getElementById('info-modal');
  if (!modal) return;
  const close = () => modal.classList.remove('open');
  document.querySelectorAll('[data-info-open]').forEach(btn => {
    btn.addEventListener('click', () => modal.classList.add('open'));
  });
  modal.addEventListener('click', e => {
    if (e.target === modal || e.target.closest('[data-info-close]')) close();
  });
})();
