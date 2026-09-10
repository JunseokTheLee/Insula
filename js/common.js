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
// ---------- campaign share image (og:image) ----------
// A 1200×630 card with the campaign drawn as the site shows it — every
// cell in grey (luminance of its target color) on white — for social
// previews and crawlers, instead of the reference photo, which stays
// hidden until the campaign is complete (supabase_mosaic_preview_image.sql).
// Made in the browser on create / reshape and from the admin page for
// older campaigns. Needs color-engine.js's luminance() by call time.
const PREVIEW_CARD_W = 1200;
const PREVIEW_CARD_H = 630;
function previewImageBlob(cells, width, height) {
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
    const l = Math.round(luminance(c.target_r, c.target_g, c.target_b));
    ctx.fillStyle = `rgb(${l},${l},${l})`;
    ctx.fillRect(ox + c.x * cell, oy + c.y * cell, Math.max(1, cell - 1), Math.max(1, cell - 1));
  }
  return new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85));
}
// Renders + uploads the share image; resolves to its public URL, or null on
// any failure (the page then falls back to the site logo).
async function uploadPreviewImage(cells, width, height) {
  try {
    const blob = await previewImageBlob(cells, width, height);
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

// ---------- collectible artwork pool (liked ∪ own) ----------
// Everything a user can add to one of their Collections: their liked pool
// above, plus every piece they've authored themselves — a user's own
// artwork should always be addable to their own collections, whether or
// not they've separately liked it. Backs the collection detail page's
// add-artwork picker (js/collection.js's openAddArtworkModal).
async function fetchCollectibleWeavoArt(userId) {
  const [liked, { data: own, error: ownErr }] = await Promise.all([
    fetchLikedWeavoArt(userId),
    sb.from('mosaic_submissions')
      .select('id,pixel_id,project_id,image_url,thumb_url,art_title,art_material,art_completed_date,art_description,art_link,author_id,author_name,author_avatar_url')
      .eq('author_id', userId),
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
