// Portfolio page (/{lang}/portfolios/{id}) — an artist's own artworks, in
// the order they chose, shown as a dark gallery: a hero with the cover, a
// grid / masonry / story layout, a slideshow, a copy-link button, and the
// owner's tools (details, add artworks, reorder, cover, delete). The share
// card the owner's browser renders here is what social apps unfurl
// (functions/{lang}/portfolios/[id].js reads preview_image_url).
// Reads the id from the URL. Needs sb, me, tr, common.js, color-engine.js,
// auth.js and lightbox.js already loaded.
"use strict";

let pf = null;            // the portfolio row
let pfOwner = null;       // its owner's profile row
let pfItems = [];         // [{submission_id, added_at, position, mosaic_submissions}] in display order
let pfEditMode = false;
let pfCardTimer = null;
let pfLoadToken = 0;

const PF_LAYOUTS = ['grid', 'masonry', 'story'];
const PF_ITEM_COLS = 'submission_id,added_at,position,mosaic_submissions(' + ARTWORK_ROW_COLS + ',is_public)';

// ---------- data ----------
// Newer columns (supabase_portfolios.sql) are asked for first and dropped
// while that file is not applied — the page then behaves like the old one.
function fetchPortfolio(id) {
  return queryWithOptional(on => {
    const itemCols = 'submission_id,added_at'
      + (on.has('order') ? ',position' : '')
      + ',mosaic_submissions(' + ARTWORK_ROW_COLS + (on.has('visibility') ? ',is_public' : '') + ')';
    const cols = 'id,owner_id,title,description,is_public,is_published,published_at,created_at'
      + (on.has('portfolio') ? ',layout,cover_submission_id,preview_image_url' : '')
      + ',mosaic_collection_items(' + itemCols + ')';
    return sb.from('mosaic_collections').select(cols).eq('id', id).maybeSingle();
  }, { portfolio: ['layout', 'cover_submission_id', 'preview_image_url'], order: ['position'], visibility: ['is_public'] });
}
function sortItems(items) {
  return items.filter(i => i.mosaic_submissions).sort((a, b) => {
    const pa = a.position == null ? Infinity : a.position, pb = b.position == null ? Infinity : b.position;
    if (pa !== pb) return pa - pb;
    return new Date(b.added_at) - new Date(a.added_at);
  });
}
function pfVisibility(c) {
  if (!c.is_public) return 'private';
  return c.is_published ? 'public' : 'link';
}
function pfCoverSub() {
  const hit = pf.cover_submission_id && pfItems.find(i => i.submission_id === pf.cover_submission_id);
  return (hit || pfItems[0] || {}).mosaic_submissions || null;
}
function isPfOwner() { return !!(pf && me.id && me.id === pf.owner_id); }
function pfUrl() { return `${location.origin}${portfolioUrl(pf.id)}`; }
function pfLayout() { return PF_LAYOUTS.includes(pf.layout) ? pf.layout : 'grid'; }

// ---------- accent colour from the cover ----------
function accentFromRgb(r, g, b) {
  // The cover's average, pushed to something that reads on near-black:
  // keep the hue, guarantee saturation and lightness.
  const max = Math.max(r, g, b) / 255, min = Math.min(r, g, b) / 255, l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > .5 ? d / (2 - max - min) : d / (max + min);
    const rr = r / 255, gg = g / 255, bb = b / 255;
    if (max === rr) h = ((gg - bb) / d + (gg < bb ? 6 : 0)) / 6;
    else if (max === gg) h = ((bb - rr) / d + 2) / 6;
    else h = ((rr - gg) / d + 4) / 6;
  }
  s = Math.max(.42, Math.min(.85, s));
  return `hsl(${Math.round(h * 360)} ${Math.round(s * 100)}% 70%)`;
}
// A 40px-wide copy of the cover for the hero backdrop: stretched over the
// hero it is already soft, so the CSS blur on top can stay small (a large
// blur over a viewport-sized layer is expensive on every scroll frame).
function tinyCopyUrl(img) {
  try {
    const c = document.createElement('canvas');
    const w = 40, h = Math.max(1, Math.round(40 * (img.naturalHeight || 1) / (img.naturalWidth || 1)));
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    return c.toDataURL('image/jpeg', 0.7);
  } catch (e) { return null; }   // cross-origin picture: keep the full-size one
}
function applyAccentFrom(img) {
  try {
    const c = imageAverageColor(img);
    if (c) document.body.style.setProperty('--pf-accent', accentFromRgb(c.r, c.g, c.b));
  } catch (e) { /* cross-origin picture: keep the default accent */ }
}

// ---------- meta ----------
function pfDescription() {
  if (pf.description) return pf.description.slice(0, 300);
  const name = (pfOwner && pfOwner.username) || tr('anonymous');
  return tr('pfMetaDescFallback', { name, n: pfItems.length });
}
function updatePortfolioMeta() {
  const name = (pfOwner && pfOwner.username) || tr('anonymous');
  const title = `${pf.title} — ${name} | Weavo`;
  const cover = pfCoverSub();
  const meta = { title, description: pfDescription(), canonical: pfUrl() };
  if (pf.preview_image_url) Object.assign(meta, { image: pf.preview_image_url, imageWidth: 1200, imageHeight: 630 });
  else if (cover) meta.image = cover.image_url;
  updatePageMeta(meta);
  // A link-only portfolio is reachable, not listed — not for search engines
  // either (the Function does the same server-side).
  if (typeof setRobotsNoindex === 'function') setRobotsNoindex(pfVisibility(pf) !== 'public');
  const url = pfUrl();
  const works = pfItems.slice(0, 12).map(i => i.mosaic_submissions).map(s => ({
    '@type': 'VisualArtwork', name: s.art_title || tr('untitledArtwork'),
    url: `${location.origin}${artworkUrl(s.id)}`, image: s.image_url,
  }));
  const data = {
    '@context': 'https://schema.org', '@type': 'CollectionPage',
    name: pf.title, url,
    creator: { '@type': 'Person', name, url: `${location.origin}${profileUrl(pfOwner && pfOwner.username ? pfOwner.username : pf.owner_id)}` },
    ...(pf.description ? { description: pf.description } : {}),
    ...(cover ? { image: pf.preview_image_url || cover.image_url } : {}),
    ...(works.length ? { hasPart: works } : {}),
  };
  injectJsonLd([data]);
}

// ---------- hero ----------
function renderHero() {
  const vis = pfVisibility(pf);
  const name = (pfOwner && pfOwner.username) || tr('anonymous');
  document.getElementById('pfTitle').textContent = pf.title;
  document.getElementById('pfDesc').textContent = pf.description || '';
  document.getElementById('pfCount').textContent = collectionItemCountText(pfItems.length);
  const badge = document.getElementById('pfVisBadge');
  badge.textContent = vis === 'link' ? tr('pfLinkOnlyBadge') : vis === 'private' ? tr('privateBadge') : '';
  badge.hidden = vis === 'public';

  const artist = document.getElementById('pfArtist');
  artist.innerHTML = '';
  artist.appendChild(miniAvatarEl(name, pfOwner && pfOwner.avatar_url, (pfOwner && pfOwner.username) || pf.owner_id));
  const text = document.createElement('div'); text.className = 'pf-artist-text';
  const link = document.createElement('a');
  link.className = 'pf-artist-name'; link.href = profileUrl((pfOwner && pfOwner.username) || pf.owner_id); link.textContent = name;
  text.appendChild(link);
  if (pfOwner && pfOwner.bio) { const bio = document.createElement('div'); bio.className = 'pf-artist-bio'; bio.textContent = pfOwner.bio; text.appendChild(bio); }
  artist.appendChild(text);
  if (pf.owner_id && me.id !== pf.owner_id) {
    const follow = document.createElement('button');
    follow.type = 'button'; follow.className = 'pf-btn pf-follow'; follow.textContent = tr('followLabel');
    follow.onclick = () => toggleUserFollow(pf.owner_id, follow);
    artist.appendChild(follow);
    if (me.id) fetchIsFollowing(me.id, pf.owner_id).then(on => {
      follow.classList.toggle('following', on);
      follow.textContent = on ? tr('followingLabel') : tr('followLabel');
    });
  }

  const cover = pfCoverSub();
  const coverEl = document.getElementById('pfCover');
  const bg = document.getElementById('pfHeroBg');
  coverEl.innerHTML = '';
  if (cover) {
    const src = cdnUrl(cover.thumb_url || cover.image_url);
    const img = document.createElement('img');
    img.alt = cover.art_title ? tr('artworkThumbAlt', { title: cover.art_title, name }) : '';
    img.src = src;
    img.addEventListener('load', () => { applyAccentFrom(img); bg.style.backgroundImage = `url("${tinyCopyUrl(img) || src}")`; }, { once: true });
    coverEl.appendChild(img);
    coverEl.onclick = () => openLightbox(cover);
    bg.style.backgroundImage = `url("${src}")`;
  } else {
    bg.style.backgroundImage = '';
    document.body.style.removeProperty('--pf-accent');
  }
}

// ---------- works ----------
let pfObserver = null;
function itemEl(item, index) {
  const sub = item.mosaic_submissions;
  const el = document.createElement('a');
  el.className = 'pf-item';
  el.href = artworkUrl(sub.id);
  el.dataset.id = sub.id;
  el.style.transitionDelay = `${Math.min(index % 12, 8) * 45}ms`;
  const img = document.createElement('img');
  img.loading = index < 8 ? 'eager' : 'lazy';
  img.decoding = 'async';
  img.src = cdnUrl(pfLayout() === 'story' ? (sub.image_url || sub.thumb_url) : (sub.thumb_url || sub.image_url));
  img.alt = sub.art_title ? tr('artworkThumbAlt', { title: sub.art_title, name: sub.author_name || tr('anonymous') }) : '';
  el.appendChild(img);
  if (sub.is_public === false && isPfOwner()) {
    const dot = document.createElement('span'); dot.className = 'pf-private-dot'; dot.textContent = tr('privateBadge');
    el.appendChild(dot);
  }
  if (pfEditMode && pf.cover_submission_id === sub.id) {
    const dot = document.createElement('span'); dot.className = 'pf-cover-dot'; dot.textContent = tr('pfCoverBadge');
    el.appendChild(dot);
  }
  const cap = document.createElement('div'); cap.className = 'pf-item-cap';
  const title = document.createElement('div'); title.className = 'pf-item-title'; title.textContent = sub.art_title || tr('untitledArtwork');
  const meta = document.createElement('div'); meta.className = 'pf-item-meta';
  meta.textContent = [sub.art_material || null, sub.art_completed_date ? fmtCompletedYear(sub.art_completed_date) : null].filter(Boolean).join(' · ');
  const desc = document.createElement('div'); desc.className = 'pf-item-desc'; desc.textContent = sub.art_description || '';
  cap.append(title, meta, desc);
  el.appendChild(cap);
  if (isPfOwner()) el.appendChild(itemToolsEl(item, index));
  interceptClick(el, () => openLightbox(sub));
  return el;
}
function itemToolsEl(item, index) {
  const wrap = document.createElement('div'); wrap.className = 'pf-item-tools';
  const mk = (label, title, onClick, cls) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'pf-tool' + (cls ? ' ' + cls : ''); b.textContent = label; b.title = title; b.setAttribute('aria-label', title);
    b.onclick = e => { e.preventDefault(); e.stopPropagation(); onClick(b); };
    return b;
  };
  const up = mk('↑', tr('pfMoveUp'), () => moveItem(index, -1));
  const down = mk('↓', tr('pfMoveDown'), () => moveItem(index, 1));
  up.disabled = index === 0; down.disabled = index === pfItems.length - 1;
  const cover = mk('★', tr('pfSetCover'), () => setCover(item.submission_id), pf.cover_submission_id === item.submission_id ? 'active' : '');
  const remove = mk('✕', tr('removeFromCollection'), () => removeItem(item), 'danger');
  wrap.append(up, down, cover, remove);
  return wrap;
}
function renderWorks() {
  const works = document.getElementById('pfWorks');
  works.dataset.layout = pfLayout();
  works.classList.toggle('pf-edit', pfEditMode);
  const list = document.getElementById('pfItems');
  list.innerHTML = '';
  pfItems.forEach((item, i) => list.appendChild(itemEl(item, i)));
  const empty = document.getElementById('pfEmpty');
  empty.hidden = pfItems.length > 0;
  document.getElementById('pfEmptyText').textContent = isPfOwner() ? tr('pfEmptyOwner') : tr('pfEmptyVisitor');
  document.getElementById('pfEmptyAdd').hidden = !isPfOwner();
  document.getElementById('pfSlideshowBtn').disabled = pfItems.length === 0;
  document.querySelectorAll('#pfLayouts button').forEach(b => b.classList.toggle('active', b.dataset.layout === pfLayout()));
  document.getElementById('pfLayouts').hidden = !isPfOwner();
  revealItems();
}
function revealItems() {
  const items = [...document.querySelectorAll('.pf-item')];
  if (pfObserver) pfObserver.disconnect();
  if (!('IntersectionObserver' in window) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    items.forEach(el => el.classList.add('in'));
    return;
  }
  pfObserver = new IntersectionObserver(entries => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); pfObserver.unobserve(e.target); }
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });
  items.forEach(el => pfObserver.observe(el));
  // Belt and braces: whatever the observer does (a background tab gets no
  // frames, and a very old browser gets none of this), nothing stays
  // invisible for long.
  const obs = pfObserver;
  setTimeout(() => { if (pfObserver === obs) items.forEach(el => el.classList.add('in')); }, 2500);
}

// ---------- owner: order / cover / remove / add ----------
async function persistOrder() {
  const rows = pfItems.map((it, i) => ({ collection_id: pf.id, submission_id: it.submission_id, position: i }));
  pfItems.forEach((it, i) => { it.position = i; });
  const { error } = await sb.from('mosaic_collection_items').upsert(rows, { onConflict: 'collection_id,submission_id' });
  if (error) { console.error('save portfolio order error:', error); toast(isSchemaMismatchError(error) ? tr('pfOrderUnavailable') : tr('couldNotUpdateCollection')); }
  scheduleShareCard();
}
function moveItem(index, dir) {
  const j = index + dir;
  if (j < 0 || j >= pfItems.length) return;
  [pfItems[index], pfItems[j]] = [pfItems[j], pfItems[index]];
  renderWorks();
  persistOrder();
}
async function setCover(submissionId) {
  const { error } = await sb.from('mosaic_collections').update({ cover_submission_id: submissionId }).eq('id', pf.id);
  if (error) { console.error('set cover error:', error); toast(isSchemaMismatchError(error) ? tr('pfOrderUnavailable') : tr('couldNotUpdateCollection')); return; }
  pf.cover_submission_id = submissionId;
  toast(tr('pfCoverSet'));
  renderHero(); renderWorks();
  scheduleShareCard();
}
async function removeItem(item) {
  const { error } = await sb.from('mosaic_collection_items').delete().eq('collection_id', pf.id).eq('submission_id', item.submission_id);
  if (error) { console.error('remove portfolio item error:', error); toast(tr('couldNotUpdateCollection')); return; }
  pfItems = pfItems.filter(i => i !== item);
  if (pf.cover_submission_id === item.submission_id) pf.cover_submission_id = null;
  renderHero(); renderWorks(); updatePortfolioMeta();
  scheduleShareCard();
}
async function openAddModal() {
  const list = document.getElementById('pf-add-list');
  const empty = document.getElementById('pf-add-empty');
  list.innerHTML = `<div class="empty-note" style="padding:20px;">${tr('loading')}</div>`;
  empty.style.display = 'none';
  document.getElementById('pf-add-modal').classList.add('open');
  // Own artworks only (supabase_portfolios.sql B2) — private ones included,
  // marked, because a portfolio is exactly where a private artwork is shown.
  const { data, error } = await fetchOwnArtworkRows(me.id);
  list.innerHTML = '';
  if (error) { console.error('load own artworks error:', error); toast(tr('couldNotLoadArtworks')); return; }
  const rows = data || [];
  empty.style.display = rows.length ? 'none' : '';
  for (const sub of rows) list.appendChild(pickRowEl(sub));
}
function pickRowEl(sub) {
  const row = document.createElement('label');
  row.className = 'pf-pick-row';
  const check = document.createElement('input');
  check.type = 'checkbox';
  check.checked = pfItems.some(i => i.submission_id === sub.id);
  check.onchange = async () => {
    check.disabled = true;
    if (check.checked) {
      const { error } = await sb.from('mosaic_collection_items').insert({ collection_id: pf.id, submission_id: sub.id, position: pfItems.length });
      let err = error;
      if (err && isSchemaMismatchError(err)) ({ error: err } = await sb.from('mosaic_collection_items').insert({ collection_id: pf.id, submission_id: sub.id }));
      check.disabled = false;
      if (err) { console.error('add portfolio item error:', err); toast(tr('couldNotUpdateCollection')); check.checked = false; return; }
      pfItems.push({ submission_id: sub.id, added_at: new Date().toISOString(), position: pfItems.length, mosaic_submissions: sub });
    } else {
      const { error } = await sb.from('mosaic_collection_items').delete().eq('collection_id', pf.id).eq('submission_id', sub.id);
      check.disabled = false;
      if (error) { console.error('remove portfolio item error:', error); toast(tr('couldNotUpdateCollection')); check.checked = true; return; }
      pfItems = pfItems.filter(i => i.submission_id !== sub.id);
      if (pf.cover_submission_id === sub.id) pf.cover_submission_id = null;
    }
    renderHero(); renderWorks(); updatePortfolioMeta();
    scheduleShareCard();
  };
  const img = document.createElement('img'); img.src = cdnUrl(sub.thumb_url || sub.image_url); img.alt = '';
  const name = document.createElement('span'); name.className = 'pf-pick-name'; name.textContent = sub.art_title || tr('untitledArtwork');
  row.append(check, img, name);
  if (sub.is_public === false) { const lock = document.createElement('span'); lock.className = 'pf-pick-lock'; lock.textContent = tr('privateBadge'); row.appendChild(lock); }
  return row;
}
function closeAddModal() { document.getElementById('pf-add-modal').classList.remove('open'); }

// ---------- owner: details / visibility / layout / delete ----------
function openEditModal() {
  document.getElementById('pe-title').value = pf.title;
  document.getElementById('pe-desc').value = pf.description || '';
  document.getElementById('pe-visibility').value = pfVisibility(pf);
  document.getElementById('pe-layout').value = pfLayout();
  document.getElementById('pe-error').textContent = '';
  syncVisibilityHint();
  document.getElementById('pf-edit-modal').classList.add('open');
}
function closeEditModal() { document.getElementById('pf-edit-modal').classList.remove('open'); }
function syncVisibilityHint() {
  const v = document.getElementById('pe-visibility').value;
  document.getElementById('pe-vis-hint').textContent = tr(v === 'public' ? 'pfVisPublicHint' : v === 'link' ? 'pfVisLinkHint' : 'pfVisPrivateHint');
}
async function saveEdit() {
  const title = document.getElementById('pe-title').value.trim();
  const errorEl = document.getElementById('pe-error');
  if (!title) { errorEl.textContent = tr('titleRequired'); return; }
  errorEl.textContent = '';
  const vis = document.getElementById('pe-visibility').value;
  const patch = {
    title,
    description: document.getElementById('pe-desc').value.trim() || null,
    is_public: vis !== 'private',
    is_published: vis === 'public',
    layout: document.getElementById('pe-layout').value,
  };
  if (vis === 'public' && !pf.is_published) patch.published_at = new Date().toISOString();
  const btn = document.getElementById('pe-submit');
  btn.disabled = true;
  let { error } = await sb.from('mosaic_collections').update(patch).eq('id', pf.id);
  if (error && isSchemaMismatchError(error)) {
    // supabase_portfolios.sql not applied yet: everything but the layout.
    const { layout, ...rest } = patch;
    ({ error } = await sb.from('mosaic_collections').update(rest).eq('id', pf.id));
  }
  btn.disabled = false;
  if (error) { console.error('update portfolio error:', error); errorEl.textContent = tr('couldNotCreateCollectionMsg', { msg: error.message }); return; }
  Object.assign(pf, patch);
  closeEditModal();
  toast(tr('pfUpdatedToast'));
  renderHero(); renderWorks(); updatePortfolioMeta(); applyOwnerUI();
  scheduleShareCard();
}
async function deletePortfolio() {
  const proceed = await confirmDialog(tr('deleteCollectionMessage'), { title: tr('deleteCollectionTitle'), okLabel: tr('deleteLabel') });
  if (!proceed) return;
  const { error } = await sb.from('mosaic_collections').delete().eq('id', pf.id);
  if (error) { console.error('delete portfolio error:', error); toast(tr('couldNotDeleteCollection')); return; }
  toast(tr('collectionDeletedToast'));
  location.href = profileUrl((pfOwner && pfOwner.username) || pf.owner_id);
}
function setEditMode(on) {
  pfEditMode = on;
  const btn = document.getElementById('pfArrangeBtn');
  btn.classList.toggle('on', on);
  btn.querySelector('.txt').textContent = on ? tr('pfDoneArranging') : tr('pfArrange');
  renderWorks();
}
function applyOwnerUI() {
  const owner = isPfOwner();
  document.getElementById('pfOwnerTools').hidden = !owner;
  if (!owner && pfEditMode) pfEditMode = false;
  renderWorks();
}

// ---------- share ----------
async function sharePortfolio() {
  const url = pfUrl();
  const name = (pfOwner && pfOwner.username) || tr('anonymous');
  const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  if (coarse && navigator.share) {
    try { await navigator.share({ title: `${pf.title} — ${name}`, url }); return; }
    catch (e) { if (e && e.name === 'AbortError') return; }
  }
  try {
    await navigator.clipboard.writeText(url);
    toast(tr('linkCopied'));
  } catch (err) {
    console.error('copy link error:', err);
    window.prompt(tr('pfCopyLinkManual'), url);
  }
}

// ---------- share card (1200×630, rendered here, read by the Function) ----------
// Re-drawn a moment after anything it shows changes — title, cover, count —
// and only by the owner, only when there is something to show. Failures are
// logged, never shown: the page then keeps the cover picture as its og:image.
function scheduleShareCard() {
  if (!isPfOwner() || !pfItems.length || pfVisibility(pf) === 'private') return;
  clearTimeout(pfCardTimer);
  pfCardTimer = setTimeout(() => renderShareCard().catch(e => console.error('portfolio share card failed:', e)), 1500);
}
function loadCardImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function drawCover(ctx, img, x, y, w, h) {
  const s = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const dw = img.naturalWidth * s, dh = img.naturalHeight * s;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}
function wrapLines(ctx, text, maxWidth, maxLines) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  const push = () => { if (line) lines.push(line); line = ''; };
  for (const word of words) {
    let candidate = line ? line + ' ' + word : word;
    if (ctx.measureText(candidate).width <= maxWidth) { line = candidate; continue; }
    if (line) { push(); candidate = word; }
    // A single word longer than the line (Korean titles have no spaces): cut it.
    while (ctx.measureText(candidate).width > maxWidth && candidate.length > 1) {
      let cut = candidate.length;
      while (cut > 1 && ctx.measureText(candidate.slice(0, cut)).width > maxWidth) cut--;
      lines.push(candidate.slice(0, cut));
      candidate = candidate.slice(cut);
      if (lines.length >= maxLines) break;
    }
    line = candidate;
    if (lines.length >= maxLines) break;
  }
  push();
  if (lines.length > maxLines) {
    lines.length = maxLines;
    let last = lines[maxLines - 1];
    while (ctx.measureText(last + '…').width > maxWidth && last.length > 1) last = last.slice(0, -1);
    lines[maxLines - 1] = last + '…';
  }
  return lines;
}
async function renderShareCard() {
  const cover = pfCoverSub();
  if (!cover || !isPfOwner()) return;
  const W = 1200, H = 630;
  const img = await loadCardImage(cdnUrl(cover.thumb_url || cover.image_url));
  if (document.fonts && document.fonts.ready) { try { await document.fonts.ready; } catch (e) {} }
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const accent = getComputedStyle(document.body).getPropertyValue('--pf-accent').trim() || '#9EFFBF';
  // backdrop: the cover, blurred and darkened
  ctx.fillStyle = '#0e100f'; ctx.fillRect(0, 0, W, H);
  ctx.save(); ctx.filter = 'blur(42px) brightness(.55) saturate(1.3)';
  drawCover(ctx, img, -80, -80, W + 160, H + 160);
  ctx.restore();
  const grad = ctx.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0, 'rgba(14,16,15,.25)'); grad.addColorStop(.5, 'rgba(14,16,15,.6)'); grad.addColorStop(1, 'rgba(14,16,15,.9)');
  ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);
  // the cover itself, framed
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 50; ctx.shadowOffsetY = 20;
  roundRectPath(ctx, 72, 75, 480, 480, 22); ctx.fillStyle = '#1c201d'; ctx.fill();
  ctx.restore();
  ctx.save(); roundRectPath(ctx, 72, 75, 480, 480, 22); ctx.clip(); drawCover(ctx, img, 72, 75, 480, 480); ctx.restore();
  // words
  const x = 620, maxW = W - x - 70;
  const font = "'Pretendard','Noto Sans KR','Segoe UI',-apple-system,Roboto,Helvetica,Arial,sans-serif";
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = accent; ctx.font = `700 21px ${font}`;
  const eyebrow = tr('pfCardEyebrow');
  let ex = x; for (const ch of eyebrow) { ctx.fillText(ch, ex, 190); ex += ctx.measureText(ch).width + 4; }
  ctx.fillStyle = '#f4f2ec'; ctx.font = `800 58px ${font}`;
  const lines = wrapLines(ctx, pf.title, maxW, 2);
  let y = 265;
  for (const line of lines) { ctx.fillText(line, x, y); y += 68; }
  const name = (pfOwner && pfOwner.username) || tr('anonymous');
  ctx.fillStyle = 'rgba(244,242,236,.92)'; ctx.font = `600 30px ${font}`;
  ctx.fillText(name, x, y + 12);
  ctx.fillStyle = 'rgba(244,242,236,.62)'; ctx.font = `500 23px ${font}`;
  ctx.fillText(collectionItemCountText(pfItems.length), x, y + 54);
  ctx.fillStyle = 'rgba(244,242,236,.55)'; ctx.font = `700 20px ${font}`;
  ctx.textAlign = 'right'; ctx.fillText('weavo.art', W - 70, H - 52); ctx.textAlign = 'left';
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.86));
  if (!blob) return;
  const url = await uploadImage(new File([blob], `portfolio-${pf.id}-card.jpg`, { type: 'image/jpeg' }));
  if (!url) return;
  const { error } = await sb.from('mosaic_collections').update({ preview_image_url: url }).eq('id', pf.id);
  if (error) { if (!isSchemaMismatchError(error)) console.error('save share card url error:', error); return; }
  pf.preview_image_url = url;
  updatePortfolioMeta();
}

// ---------- slideshow ----------
const show = {
  idx: 0, playing: false, timer: null, raf: null, startedAt: 0,
  DUR: 6000,
  el: null,
};
function showEls() {
  return {
    root: document.getElementById('pfShow'), img: document.getElementById('pfShowImg'),
    title: document.getElementById('pfShowTitle'), meta: document.getElementById('pfShowMeta'),
    desc: document.getElementById('pfShowDesc'), count: document.getElementById('pfShowCount'),
    bar: document.getElementById('pfShowBar'), play: document.getElementById('pfShowPlay'),
  };
}
function openShow(startIndex) {
  if (!pfItems.length) return;
  const e = showEls();
  show.idx = Math.max(0, Math.min(startIndex || 0, pfItems.length - 1));
  e.root.hidden = false;
  document.body.classList.add('modal-open-show');
  if (e.root.requestFullscreen) e.root.requestFullscreen().catch(() => {});
  renderShowSlide(false);
  setShowPlaying(true);
}
function closeShow() {
  const e = showEls();
  setShowPlaying(false);
  e.root.hidden = true;
  document.body.classList.remove('modal-open-show');
  if (document.fullscreenElement === e.root && document.exitFullscreen) document.exitFullscreen().catch(() => {});
}
function renderShowSlide(fade) {
  const e = showEls();
  const sub = pfItems[show.idx].mosaic_submissions;
  const paint = () => {
    e.img.src = cdnUrl(sub.image_url || sub.thumb_url);
    e.img.alt = sub.art_title || '';
    e.title.textContent = sub.art_title || tr('untitledArtwork');
    e.meta.textContent = [sub.art_material || null, sub.art_completed_date ? fmtCompletedYear(sub.art_completed_date) : null].filter(Boolean).join(' · ');
    e.desc.textContent = sub.art_description || '';
    e.count.textContent = tr('pfOf', { i: show.idx + 1, n: pfItems.length });
    e.img.classList.remove('fade');
  };
  if (fade && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    e.img.classList.add('fade');
    setTimeout(paint, 220);
  } else paint();
  // Prefetch the next picture so the crossfade lands on a loaded image.
  const next = pfItems[(show.idx + 1) % pfItems.length].mosaic_submissions;
  const pre = new Image(); pre.src = cdnUrl(next.image_url || next.thumb_url);
  restartShowBar();
}
function stepShow(dir) {
  show.idx = (show.idx + dir + pfItems.length) % pfItems.length;
  renderShowSlide(true);
}
function restartShowBar() {
  const e = showEls();
  cancelAnimationFrame(show.raf);
  clearTimeout(show.timer);
  e.bar.style.width = '0%';
  if (!show.playing) return;
  show.startedAt = performance.now();
  const tick = now => {
    const p = Math.min(1, (now - show.startedAt) / show.DUR);
    e.bar.style.width = `${p * 100}%`;
    if (p < 1) show.raf = requestAnimationFrame(tick);
    else stepShow(1);
  };
  show.raf = requestAnimationFrame(tick);
}
function setShowPlaying(on) {
  show.playing = on;
  const e = showEls();
  e.play.classList.toggle('on', on);
  e.play.textContent = on ? tr('pfPause') : tr('pfAutoplay');
  restartShowBar();
}
function wireShow() {
  const e = showEls();
  document.getElementById('pfShowClose').onclick = closeShow;
  document.getElementById('pfShowPrev').onclick = () => { stepShow(-1); };
  document.getElementById('pfShowNext').onclick = () => { stepShow(1); };
  e.play.onclick = () => setShowPlaying(!show.playing);
  document.addEventListener('keydown', ev => {
    if (e.root.hidden) return;
    if (ev.key === 'Escape') closeShow();
    else if (ev.key === 'ArrowRight' || ev.key === ' ') { ev.preventDefault(); stepShow(1); }
    else if (ev.key === 'ArrowLeft') { ev.preventDefault(); stepShow(-1); }
  });
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && !e.root.hidden) closeShow(); });
  // Swipe on touch screens.
  let x0 = null;
  e.root.addEventListener('touchstart', ev => { x0 = ev.touches[0].clientX; }, { passive: true });
  e.root.addEventListener('touchend', ev => {
    if (x0 == null) return;
    const dx = ev.changedTouches[0].clientX - x0; x0 = null;
    if (Math.abs(dx) > 40) stepShow(dx < 0 ? 1 : -1);
  }, { passive: true });
  // The stage pauses while the pointer rests on it — reading time.
  e.root.querySelector('.pf-show-stage').addEventListener('mouseenter', () => { if (show.playing) { cancelAnimationFrame(show.raf); } });
  e.root.querySelector('.pf-show-stage').addEventListener('mouseleave', () => { if (show.playing) restartShowBar(); });
}

// ---------- more by this artist ----------
async function renderMoreBy() {
  const box = document.getElementById('pfMore');
  const grid = document.getElementById('pfMoreGrid');
  box.hidden = true; grid.innerHTML = '';
  const { data, error } = await queryWithOptional(on => sb.from('mosaic_collections')
    .select('id,owner_id,title,published_at,created_at' + (on.has('cover') ? ',cover_submission_id' : '')
      + ',mosaic_collection_items(submission_id,added_at' + (on.has('order') ? ',position' : '') + ',mosaic_submissions(thumb_url,image_url))')
    .eq('owner_id', pf.owner_id).eq('is_public', true).eq('is_published', true).neq('id', pf.id)
    .order('published_at', { ascending: false, nullsFirst: false }).limit(6),
    { cover: ['cover_submission_id'], order: ['position'] });
  if (error) { console.error('load more portfolios error:', error); return; }
  const rows = (data || []).filter(c => (c.mosaic_collection_items || []).length);
  if (!rows.length) return;
  rows.forEach((c, i) => grid.appendChild(portfolioCardEl(c, pfOwner, i)));
  box.hidden = false;
}

// ---------- boot ----------
async function openPortfolio(id) {
  const token = ++pfLoadToken;
  const { data, error } = await fetchPortfolio(id);
  if (token !== pfLoadToken) return;
  if (error) console.error('load portfolio error:', error);
  if (!data) {
    document.getElementById('pfTitle').textContent = tr('collectionNotFound');
    document.getElementById('pfCount').textContent = '';
    document.getElementById('pfEmpty').hidden = true;
    return;
  }
  pf = data;
  pfItems = sortItems(pf.mosaic_collection_items || []);
  const { data: owner } = await sb.from('profiles').select('id,username,avatar_url,bio').eq('id', pf.owner_id).maybeSingle();
  if (token !== pfLoadToken) return;
  pfOwner = owner || null;
  renderHero();
  applyOwnerUI();
  updatePortfolioMeta();
  renderMoreBy();
  // A private artwork's own page lands here with ?artwork= (it is shown
  // inside the portfolio): open it straight away.
  const wanted = new URLSearchParams(location.search).get('artwork');
  if (wanted) {
    const hit = pfItems.find(i => String(i.submission_id) === String(wanted));
    if (hit) openLightbox(hit.mosaic_submissions);
  }
}

document.getElementById('pfShareBtn').onclick = sharePortfolio;
document.getElementById('pfSlideshowBtn').onclick = () => openShow(0);
document.getElementById('pfEditBtn').onclick = openEditModal;
document.getElementById('pfAddBtn').onclick = openAddModal;
document.getElementById('pfEmptyAdd').onclick = openAddModal;
document.getElementById('pfArrangeBtn').onclick = () => setEditMode(!pfEditMode);
document.getElementById('pfDeleteBtn').onclick = deletePortfolio;
document.getElementById('pe-cancel').onclick = closeEditModal;
document.getElementById('pe-submit').onclick = saveEdit;
document.getElementById('pe-visibility').onchange = syncVisibilityHint;
document.getElementById('pf-edit-modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeEditModal(); });
document.getElementById('pf-add-done').onclick = closeAddModal;
document.getElementById('pf-add-modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeAddModal(); });
document.querySelectorAll('#pfLayouts button').forEach(b => {
  b.onclick = async () => {
    if (!isPfOwner() || b.dataset.layout === pfLayout()) return;
    const { error } = await sb.from('mosaic_collections').update({ layout: b.dataset.layout }).eq('id', pf.id);
    if (error) { console.error('layout update error:', error); toast(isSchemaMismatchError(error) ? tr('pfOrderUnavailable') : tr('couldNotUpdateCollection')); return; }
    pf.layout = b.dataset.layout;
    renderWorks();
  };
});
wireShow();
setupBackLink(document.getElementById('pfBackBtn'));
document.addEventListener('weavo:authchange', () => { if (pf) { renderHero(); applyOwnerUI(); } });
window.onSubmissionDeleted = () => { if (pf) openPortfolio(pf.id); };
window.onSubmissionUpdated = () => { if (pf) openPortfolio(pf.id); };

authReady.then(async () => {
  const id = routeParam('portfolios');
  if (!id) { document.getElementById('pfTitle').textContent = tr('collectionNotFound'); return; }
  await openPortfolio(id);
});
