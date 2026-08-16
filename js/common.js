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
  const name = (owner && (owner.username || owner.name)) || tr('anonymous');
  const card = document.createElement('a');
  card.className = 'artwork-card';
  card.href = collectionUrl(collection.id);
  card.style.animationDelay = `${Math.min(i, 10) * 0.05}s`;

  const coverUrl = collectionCoverUrl(collection);
  if (coverUrl) {
    const img = document.createElement('img');
    img.className = 'artwork-card-img';
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
    avatar.className = 'art-byline-avatar'; avatar.src = cdnUrl(owner.avatar_url); avatar.alt = '';
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
    .select('id,name,username,avatar_url').in('id', ownerIds);
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
  if (thumbUrl) img.src = thumbUrl;
  img.alt = '';
  row.appendChild(img);

  const info = document.createElement('div'); info.className = 'recent-list-info';
  const titleEl = document.createElement('div'); titleEl.className = 'recent-list-title'; titleEl.textContent = title;
  const meta = document.createElement('div'); meta.className = 'recent-list-meta';
  if (avatarUrl) {
    const avatar = document.createElement('img');
    avatar.className = 'recent-list-avatar'; avatar.src = avatarUrl; avatar.alt = '';
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
// current URL's path is (e.g. from /en/projects/abc, a bare "artists/x"
// would resolve to /en/projects/artists/x — wrong).
function profileUrl(userId) {
  return `/${CURRENT_LANG}/artists/${encodeURIComponent(userId)}`;
}
// Real path to a project's detail page (functions/[lang]/projects/[id].js).
function projectUrl(id) {
  return `/${CURRENT_LANG}/projects/${encodeURIComponent(id)}`;
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
// Pages-Function-rendered route (e.g. /en/projects/abc -> "abc"), falling
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

// Downscaled copy of an uploaded artwork file, for every place it's shown
// small (weavo grid cells, list/profile thumbnails, project preview
// canvases) so those views don't each pull the full-resolution original
// just to shrink it back down. Resolves null (not rejects) on any failure —
// callers treat a missing thumbnail as "fall back to the full image".
const THUMB_MAX_DIM = 480;
function makeThumbnailBlob(file) {
  const objectUrl = URL.createObjectURL(file);
  return loadImageEl(objectUrl).then(img => {
    const scale = Math.min(1, THUMB_MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
    return new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.82));
  }).catch(() => null).finally(() => URL.revokeObjectURL(objectUrl));
}

// Uploads both the full-resolution artwork file (image_url) and a
// downscaled thumbnail (thumb_url) alongside it in the same `artwork`
// bucket, under a `thumb/` prefix. A thumbnail upload failure still returns
// the full-res url — the artwork itself shouldn't be blocked by it.
async function uploadArtworkImage(file) {
  const url = await uploadImage(file);
  if (!url) return { url: null, thumbUrl: null };
  const thumbBlob = await makeThumbnailBlob(file);
  if (!thumbBlob) return { url, thumbUrl: null };
  const path = `thumb/${me.id}/${Date.now()}.jpg`;
  const { error } = await sb.storage.from('artwork').upload(path, thumbBlob, { cacheControl: '31536000', contentType: 'image/jpeg' });
  if (error) { console.error('uploadArtworkImage thumb error:', error); return { url, thumbUrl: null }; }
  return { url, thumbUrl: sb.storage.from('artwork').getPublicUrl(path).data.publicUrl };
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

// ---------- user-to-user saves (follow) ----------
// Direct saves are asymmetric (like a follow) — shared by the profile
// page's own Save button/counts (js/profile-view.js) and the lightbox's
// artist-card save button (js/lightbox.js's setupLightboxArtistSave), since
// both let you save/unsave a person, just from different surfaces.
async function fetchSaveCounts(userId) {
  const [{ count: saves, error: savesErr }, { count: savedBy, error: savedByErr }] = await Promise.all([
    sb.from('user_saves').select('*', { count: 'exact', head: true }).eq('saver_id', userId),
    sb.from('user_saves').select('*', { count: 'exact', head: true }).eq('saved_id', userId),
  ]);
  if (savesErr) console.error('load save counts (saves) error:', savesErr);
  if (savedByErr) console.error('load save counts (saved by) error:', savedByErr);
  return { saves: saves || 0, savedBy: savedBy || 0 };
}
async function fetchIsSaving(viewerId, targetId) {
  const { data, error } = await sb.from('user_saves').select('saver_id')
    .eq('saver_id', viewerId).eq('saved_id', targetId).maybeSingle();
  if (error) console.error('load is-saving error:', error);
  return !!data;
}
// Updates #profileSavedByN in place if present (the profile page's own
// counts row) — a no-op elsewhere (e.g. the lightbox's artist-card button),
// where that element doesn't exist on the page at all.
async function toggleUserSave(targetId, btn) {
  if (!me.id) { openAuthModal(); return; }
  const wasSaving = btn.classList.contains('saving');
  btn.disabled = true;
  const { error } = wasSaving
    ? await sb.from('user_saves').delete().eq('saver_id', me.id).eq('saved_id', targetId)
    : await sb.from('user_saves').insert({ saver_id: me.id, saved_id: targetId });
  btn.disabled = false;
  if (error) { console.error('toggle save error:', error); toast(tr('couldNotUpdateSaveUser')); return; }
  btn.classList.toggle('saving', !wasSaving);
  btn.textContent = !wasSaving ? tr('savingLabel') : tr('saveLabel');
  const savedByEl = document.getElementById('profileSavedByN');
  if (savedByEl) savedByEl.textContent = Number(savedByEl.textContent || 0) + (wasSaving ? -1 : 1);
}

// Keys must match what the profile editor already writes into
// profiles.links (jsonb). Labels are the same in both languages.
const LINK_PLATFORMS = [
  { key: 'instagram', label: 'Instagram' },
  { key: 'twitter',   label: 'Twitter / X' },
  { key: 'tiktok',    label: 'TikTok' },
  { key: 'website',   label: 'Website' },
];

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
