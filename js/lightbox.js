// Artwork lightbox — used by project.html (weavo grid + list view) and
// profile.html (submitted/saved art grids). Needs sb, me, tr, common.js
// (confirmDialog/miniAvatarEl/safeHref), and the d3 + topojson CDN scripts
// (for the artist's country locator map) already loaded on the page.
//
// A page that wants to refresh itself after a submission is deleted should
// define `window.onSubmissionDeleted = (sub) => {...}` before this loads.
"use strict";

const lbImg = document.getElementById('lightbox-img');
const lbStage = document.getElementById('lightboxStage');
const lbZoomLevel = document.getElementById('lightbox-zoom-level');
const lbZoomInBtn = document.getElementById('lightbox-zoom-in');
const lbZoomOutBtn = document.getElementById('lightbox-zoom-out');
const LB_MIN_ZOOM = 1, LB_MAX_ZOOM = 4, LB_ZOOM_STEP = 0.5;
let lbScale = 1, lbX = 0, lbY = 0;
let lbCurrentSub = null;

function applyLbTransform() {
  lbImg.style.transform = `translate(${lbX}px, ${lbY}px) scale(${lbScale})`;
  lbImg.classList.toggle('zoomed', lbScale > 1);
  lbZoomLevel.textContent = `${Math.round(lbScale * 100)}%`;
  lbZoomOutBtn.disabled = lbScale <= LB_MIN_ZOOM;
  lbZoomInBtn.disabled = lbScale >= LB_MAX_ZOOM;
}
function setLbZoom(scale) {
  lbScale = Math.min(LB_MAX_ZOOM, Math.max(LB_MIN_ZOOM, scale));
  if (lbScale === LB_MIN_ZOOM) { lbX = 0; lbY = 0; }
  applyLbTransform();
}
function resetLbZoom() { lbScale = 1; lbX = 0; lbY = 0; applyLbTransform(); }

// ---------- lightbox artist card (larger avatar + bio + country map) ----------
// Renders instantly from the denormalized author_* fields already on the
// submission, then loadLightboxArtistDetails() below fetches the fuller
// profile (bio, current avatar, country) to fill in the rest.
function renderLightboxArtistCard(sub) {
  const cardEl = document.getElementById('lightbox-artist-card');
  const avatarWrap = document.getElementById('lightbox-artist-avatar-wrap');
  const nameBtn = document.getElementById('lightbox-artist-name');
  const aboutEl = document.getElementById('lightbox-artist-about');
  avatarWrap.innerHTML = '';
  document.getElementById('lightbox-artist-bio').textContent = '';
  aboutEl.classList.remove('visible');
  document.getElementById('lightbox-country-map').style.display = 'none';
  if (!sub.author_id) { cardEl.style.display = 'none'; return; }
  cardEl.style.display = '';
  avatarWrap.appendChild(miniAvatarEl(sub.author_name, sub.author_avatar_url, sub.author_id, 'lb-artist-avatar'));
  nameBtn.textContent = sub.author_name || '';
  nameBtn.href = profileUrl(sub.author_id);
}
// Lets you follow the artist straight from their artwork, without
// navigating to their profile page first. Hidden for your own artwork and
// when the card itself is hidden (no author_id — see renderLightboxArtistCard).
let lbArtistFollowToken = 0;
async function setupLightboxArtistFollow(sub) {
  const btn = document.getElementById('lightbox-artist-follow-btn');
  if (!btn) return; // not every page embedding the lightbox markup has this button
  const myToken = ++lbArtistFollowToken;
  if (!sub.author_id || sub.author_id === me.id) { btn.style.display = 'none'; return; }
  btn.style.display = '';
  btn.disabled = false;
  btn.classList.remove('following');
  btn.textContent = tr('followLabel');
  btn.onclick = () => toggleUserFollow(sub.author_id, btn);
  if (!me.id) return;
  const isFollowing = await fetchIsFollowing(me.id, sub.author_id);
  if (myToken !== lbArtistFollowToken) return; // a newer lightbox item opened while this was in flight
  btn.classList.toggle('following', isFollowing);
  btn.textContent = isFollowing ? tr('followingLabel') : tr('followLabel');
}
let lbArtistDetailsToken = 0;
async function loadLightboxArtistDetails(sub) {
  if (!sub.author_id) { renderLightboxCountryMap(null); return; }
  const myToken = ++lbArtistDetailsToken;
  const { data: profile } = await sb.from('profiles')
    .select('avatar_url,bio,country_id').eq('id', sub.author_id).maybeSingle();
  if (myToken !== lbArtistDetailsToken) return; // a newer lightbox item opened while this was in flight
  if (profile && profile.avatar_url) {
    const avatarWrap = document.getElementById('lightbox-artist-avatar-wrap');
    avatarWrap.innerHTML = '';
    avatarWrap.appendChild(miniAvatarEl(sub.author_name, profile.avatar_url, sub.author_id, 'lb-artist-avatar'));
  }
  document.getElementById('lightbox-artist-bio').textContent = (profile && profile.bio) || '';
  document.getElementById('lightbox-artist-about').classList.toggle('visible', !!(profile && profile.bio));
  renderLightboxCountryMap(profile && profile.country_id);
}

// ---------- mini country locator map (bottom of lightbox sidebar) ----------
let worldTopoPromise = null;
function loadWorldTopo() {
  if (!worldTopoPromise) {
    worldTopoPromise = fetch('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json').then(r => r.json());
  }
  return worldTopoPromise;
}
let lbCountryMapBuilt = false;
async function renderLightboxCountryMap(countryId) {
  const wrap = document.getElementById('lightbox-country-map');
  if (!countryId) { wrap.style.display = 'none'; return; }
  // The locator map is a nicety, and d3/topojson are 300KB — a page may
  // reasonably skip them (the game page does). Without them the map is
  // simply not shown; the lightbox itself must still open.
  if (typeof d3 === 'undefined' || typeof topojson === 'undefined') { wrap.style.display = 'none'; return; }
  let worldData;
  try { worldData = await loadWorldTopo(); }
  catch (e) { console.error('world map load error:', e); wrap.style.display = 'none'; return; }
  const svg = d3.select('#lb-country-map-svg');
  if (!lbCountryMapBuilt) {
    const W = 280, H = 150;
    const projection = d3.geoNaturalEarth1().scale(45).translate([W / 2, H / 2]);
    const path = d3.geoPath().projection(projection);
    const countries = topojson.feature(worldData, worldData.objects.countries);
    svg.selectAll('path.lb-country')
      .data(countries.features)
      .join('path')
      .attr('class', 'lb-country')
      .attr('d', path);
    lbCountryMapBuilt = true;
  }
  svg.selectAll('path.lb-country').classed('active', d => String(d.id) === String(countryId));
  document.getElementById('lb-country-map-label').textContent = countryName(countryId);
  wrap.style.display = 'block';
}

// ---------- add-to-exhibition multi-select dropdown ----------
// Built once here — rather than repeated in every page's static HTML —
// and inserted into .lightbox-actions, whose markup is identical across
// every page that embeds the lightbox (see the file banner comment). Lets
// you drop the piece you're looking at straight into any of your own
// exhibitions without it needing to be liked first, unlike the liked-pool
// pickers elsewhere (profile.html's add-to-collection modal, collection.html's
// own add-artwork modal) — mosaic_collection_items has no such constraint,
// those two just happen to only ever offer pieces from that pool.
const lbExhibitWrap = document.createElement('div');
lbExhibitWrap.className = 'lb-exhibit-wrap';
lbExhibitWrap.innerHTML = `
  <button type="button" id="lb-exhibit-btn" class="lb-action-btn lb-exhibit-btn" aria-haspopup="true" aria-expanded="false">
    <span class="icon"></span><span class="lb-exhibit-label"></span><span class="lb-exhibit-caret" aria-hidden="true">&#9662;</span>
  </button>
  <div class="lb-exhibit-menu" id="lb-exhibit-menu"></div>`;
(() => {
  const actions = document.querySelector('.lightbox-actions');
  if (actions) actions.insertBefore(lbExhibitWrap, document.getElementById('lb-delete-btn'));
})();
const lbExhibitBtn = document.getElementById('lb-exhibit-btn');
const lbExhibitMenu = document.getElementById('lb-exhibit-menu');
if (lbExhibitBtn) lbExhibitBtn.querySelector('.lb-exhibit-label').textContent = tr('addToExhibitionBtn');

// ---------- report this artwork (built dynamically — same rationale as the
// exhibit dropdown above) ----------
const lbReportBtn = document.createElement('button');
lbReportBtn.type = 'button';
lbReportBtn.id = 'lb-report-btn';
lbReportBtn.className = 'lb-action-btn';
lbReportBtn.innerHTML = `<span class="icon"></span><span>${tr('reportBtnLabel')}</span>`;
lbReportBtn.setAttribute('aria-label', tr('reportAriaLabel_submission'));
(() => {
  const actions = document.querySelector('.lightbox-actions');
  if (actions) actions.insertBefore(lbReportBtn, document.getElementById('lb-delete-btn'));
})();
lbReportBtn.onclick = () => { if (lbCurrentSub) openReportModal('submission', lbCurrentSub.id); };

// ---------- block this artwork's author (sits next to Report — same
// rationale for building it here rather than in every page's markup) ----------
const lbBlockBtn = document.createElement('button');
lbBlockBtn.type = 'button';
lbBlockBtn.id = 'lb-block-btn';
lbBlockBtn.className = 'lb-action-btn';
lbBlockBtn.innerHTML = `<span class="icon"></span><span class="lb-block-label"></span>`;
(() => {
  const actions = document.querySelector('.lightbox-actions');
  if (actions) actions.insertBefore(lbBlockBtn, document.getElementById('lb-delete-btn'));
})();
function refreshLbBlockBtn() {
  if (!lbCurrentSub) return;
  const blocked = isUserBlocked(lbCurrentSub.author_id);
  lbBlockBtn.querySelector('.lb-block-label').textContent = tr(blocked ? 'unblockLabel' : 'blockLabel');
  lbBlockBtn.setAttribute('aria-label', tr(blocked ? 'unblockAriaLabel_submission' : 'blockAriaLabel_submission'));
  lbBlockBtn.classList.toggle('blocked', blocked);
}
lbBlockBtn.onclick = async () => {
  if (!lbCurrentSub) return;
  await toggleUserBlock(lbCurrentSub.author_id, lbBlockBtn);
  refreshLbBlockBtn();
  loadLightboxComments(lbCurrentSub); // re-filter now that the author's block state just changed
};

// ---------- edit this artwork's details (author only — button + modal built
// dynamically here, same rationale as the exhibit dropdown / report button
// above: keeps it out of every page's copy of the lightbox markup). Only the
// five text detail fields are editable; the image and its placement are not
// (that would be a delete-and-resubmit — see supabase_mosaic_edit_art_details.sql). ----------
const lbEditBtn = document.createElement('button');
lbEditBtn.type = 'button';
lbEditBtn.id = 'lb-edit-btn';
lbEditBtn.className = 'lb-action-btn';
lbEditBtn.style.display = 'none';
lbEditBtn.innerHTML = `<span class="icon"></span><span>${tr('editArtworkBtn')}</span>`;
lbEditBtn.setAttribute('aria-label', tr('editArtworkTitle'));
(() => {
  const actions = document.querySelector('.lightbox-actions');
  if (actions) actions.insertBefore(lbEditBtn, document.getElementById('lb-delete-btn'));
})();

const lbEditModal = document.createElement('div');
lbEditModal.id = 'lb-edit-modal';
lbEditModal.className = 'modal-overlay';
lbEditModal.innerHTML = `
  <div class="modal-panel">
    <h3>${tr('editArtworkTitle')}</h3>
    <div class="field">
      <label for="lb-edit-title">${tr('artTitleLabel')} <span class="field-hint">${tr('optionalHint')}</span></label>
      <input type="text" id="lb-edit-title" placeholder="${tr('artTitlePlaceholder')}" maxlength="80">
    </div>
    <div style="display:flex;gap:10px;">
      <div class="field" style="flex:1;">
        <label for="lb-edit-material">${tr('artMaterialLabel')} <span class="field-hint">${tr('optionalHint')}</span></label>
        <input type="text" id="lb-edit-material" placeholder="${tr('artMaterialPlaceholder')}" maxlength="100">
      </div>
      <div class="field" style="flex:1;">
        <label for="lb-edit-completed">${tr('artCompletedLabel')} <span class="field-hint">${tr('optionalHint')}</span></label>
        <input type="number" inputmode="numeric" id="lb-edit-completed" placeholder="${tr('artYearPlaceholder')}" min="${MIN_ART_YEAR}" max="">
      </div>
    </div>
    <div class="field">
      <label for="lb-edit-desc">${tr('artStatementLabel')} <span class="field-hint">${tr('optionalHint')}</span></label>
      <textarea id="lb-edit-desc" placeholder="${tr('artStatementPlaceholder')}" maxlength="500"></textarea>
    </div>
    <div class="field">
      <label for="lb-edit-link">${tr('artLinkLabel')} <span class="field-hint">${tr('optionalHint')}</span></label>
      <input type="text" id="lb-edit-link" placeholder="https://your-portfolio.com" maxlength="300">
    </div>
    <div class="field" id="lb-edit-optout-row" style="display:none;">
      <label class="lb-edit-check"><input type="checkbox" id="lb-edit-optout"> ${tr('editOptOutColoring')}</label>
    </div>
    <div class="field-error" id="lb-edit-error"></div>
    <div class="modal-actions">
      <button type="button" id="lb-edit-cancel" class="btn-cancel">${tr('cancelLabel')}</button>
      <button type="button" id="lb-edit-save" class="btn-primary">${tr('saveLabel')}</button>
    </div>
  </div>`;
document.body.appendChild(lbEditModal);

function closeLbEditModal() { lbEditModal.classList.remove('open'); }
lbEditModal.querySelector('#lb-edit-cancel').onclick = closeLbEditModal;
lbEditModal.addEventListener('click', e => { if (e.target === lbEditModal) closeLbEditModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && lbEditModal.classList.contains('open')) closeLbEditModal(); });

function openLbEditModal() {
  const sub = lbCurrentSub;
  if (!sub) return;
  lbEditModal.querySelector('#lb-edit-title').value = sub.art_title || '';
  lbEditModal.querySelector('#lb-edit-material').value = sub.art_material || '';
  const completedEl = lbEditModal.querySelector('#lb-edit-completed');
  // Year-only field (stored as YYYY-01-01 — see artDateToYear in common.js).
  completedEl.max = new Date().getFullYear();
  completedEl.value = artDateToYear(sub.art_completed_date);
  lbEditModal.querySelector('#lb-edit-desc').value = sub.art_description || '';
  lbEditModal.querySelector('#lb-edit-link').value = sub.art_link || '';
  lbEditModal.querySelector('#lb-edit-error').textContent = '';
  // The opt-out column exists only once supabase_pixel_game.sql is applied;
  // the row shows when it can be read.
  const optRow = lbEditModal.querySelector('#lb-edit-optout-row');
  optRow.style.display = 'none';
  sb.from('mosaic_submissions').select('coloring_opt_out').eq('id', sub.id).maybeSingle().then(({ data, error }) => {
    if (error || !data || lbCurrentSub !== sub) return;
    sub.coloring_opt_out = !!data.coloring_opt_out;
    lbEditModal.querySelector('#lb-edit-optout').checked = sub.coloring_opt_out;
    optRow.style.display = '';
  });
  lbEditModal.classList.add('open');
}
lbEditBtn.onclick = openLbEditModal;

lbEditModal.querySelector('#lb-edit-save').onclick = async () => {
  const sub = lbCurrentSub;
  if (!sub) return;
  const errorEl = lbEditModal.querySelector('#lb-edit-error');
  const link = lbEditModal.querySelector('#lb-edit-link').value.trim();
  if (link && !safeHref(link)) { errorEl.textContent = tr('linkMustBeValidUrl'); return; }
  const completedYear = artYearToDate(lbEditModal.querySelector('#lb-edit-completed').value);
  if (completedYear.error) { errorEl.textContent = completedYear.error; return; }
  errorEl.textContent = '';
  const patch = {
    art_title: lbEditModal.querySelector('#lb-edit-title').value.trim() || null,
    art_material: lbEditModal.querySelector('#lb-edit-material').value.trim() || null,
    art_completed_date: completedYear.date,
    art_description: lbEditModal.querySelector('#lb-edit-desc').value.trim() || null,
    art_link: link || null,
  };
  const saveBtn = lbEditModal.querySelector('#lb-edit-save');
  saveBtn.disabled = true;
  const { error } = await sb.from('mosaic_submissions').update(patch).eq('id', sub.id);
  saveBtn.disabled = false;
  if (error) { console.error('edit artwork error:', error); errorEl.textContent = tr('couldNotUpdateArtwork'); return; }
  Object.assign(sub, patch);
  // Opt-out is its own update: the column may not exist yet, and a failure
  // here must not undo the details that were just saved.
  const optRow = lbEditModal.querySelector('#lb-edit-optout-row');
  if (optRow.style.display !== 'none') {
    const optOut = lbEditModal.querySelector('#lb-edit-optout').checked;
    if (optOut !== !!sub.coloring_opt_out) {
      const { error: optErr } = await sb.from('mosaic_submissions').update({ coloring_opt_out: optOut }).eq('id', sub.id);
      if (optErr) console.error('coloring opt-out update error:', optErr);
      else { sub.coloring_opt_out = optOut; renderLightboxColoring(sub); }
    }
  }
  applyArtDetailsToCaption(sub);
  closeLbEditModal();
  toast(tr('artworkUpdatedToast'));
  // Lets the host page refresh anything showing the old title/details
  // (thumbnail alt/tooltips, meta tags) — same hook shape as onSubmissionDeleted.
  if (typeof window.onSubmissionUpdated === 'function') window.onSubmissionUpdated(sub);
};

function lbExhibitRowEl(collection) {
  const row = document.createElement('label');
  row.className = 'lb-exhibit-row';
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  const items = collection.mosaic_collection_items || [];
  checkbox.checked = items.some(i => i.submission_id === lbCurrentSub.id);
  checkbox.onchange = async () => {
    checkbox.disabled = true;
    const { error } = checkbox.checked
      ? await sb.from('mosaic_collection_items').insert({ collection_id: collection.id, submission_id: lbCurrentSub.id })
      : await sb.from('mosaic_collection_items').delete().eq('collection_id', collection.id).eq('submission_id', lbCurrentSub.id);
    checkbox.disabled = false;
    if (error) { console.error('update exhibition item error:', error); toast(tr('couldNotUpdateCollection')); checkbox.checked = !checkbox.checked; return; }
    if (checkbox.checked) items.push({ submission_id: lbCurrentSub.id });
    else { const idx = items.findIndex(i => i.submission_id === lbCurrentSub.id); if (idx !== -1) items.splice(idx, 1); }
  };
  const name = document.createElement('span'); name.textContent = collection.title;
  row.append(checkbox, name);
  return row;
}
function lbExhibitNewRowEl() {
  const wrap = document.createElement('div'); wrap.className = 'lb-exhibit-new';
  const input = document.createElement('input');
  input.type = 'text'; input.placeholder = tr('newExhibitionTitlePlaceholder'); input.maxLength = 80;
  const createBtn = document.createElement('button');
  createBtn.type = 'button'; createBtn.textContent = tr('createLabel');
  createBtn.onclick = async () => {
    const title = input.value.trim();
    if (!title) return;
    createBtn.disabled = true;
    // New exhibitions start unpublished/draft by default (see
    // supabase_mosaic_collections_publish.sql) — the owner publishes it
    // themselves from its own page once it's ready.
    const { data: created, error: createErr } = await sb.from('mosaic_collections')
      .insert({ owner_id: me.id, title, is_public: true }).select('id,title').single();
    if (createErr) { console.error('create exhibition error:', createErr); toast(tr('couldNotCreateCollectionRetry')); createBtn.disabled = false; return; }
    const { error: addErr } = await sb.from('mosaic_collection_items').insert({ collection_id: created.id, submission_id: lbCurrentSub.id });
    if (addErr) console.error('add to new exhibition error:', addErr);
    createBtn.disabled = false;
    input.value = '';
    toast(tr('collectionCreatedToast'));
    renderLbExhibitMenu();
  };
  input.onkeydown = e => { if (e.key === 'Enter') createBtn.click(); };
  wrap.append(input, createBtn);
  return wrap;
}
async function renderLbExhibitMenu() {
  lbExhibitMenu.innerHTML = `<div class="lb-exhibit-loading">${tr('loading')}</div>`;
  const { data, error } = await sb.from('mosaic_collections')
    .select('id,title,mosaic_collection_items(submission_id)')
    .eq('owner_id', me.id)
    .order('created_at', { ascending: false });
  if (error) { console.error('load my exhibitions error:', error); lbExhibitMenu.innerHTML = ''; toast(tr('couldNotLoadCollections')); return; }
  lbExhibitMenu.innerHTML = '';
  const collections = data || [];
  if (!collections.length) {
    const empty = document.createElement('div'); empty.className = 'lb-exhibit-empty'; empty.textContent = tr('noCollectionsYet');
    lbExhibitMenu.appendChild(empty);
  } else {
    for (const c of collections) lbExhibitMenu.appendChild(lbExhibitRowEl(c));
  }
  lbExhibitMenu.appendChild(lbExhibitNewRowEl());
}
function closeLbExhibitMenu() {
  if (!lbExhibitBtn) return;
  lbExhibitMenu.classList.remove('open');
  lbExhibitBtn.classList.remove('open');
  lbExhibitBtn.setAttribute('aria-expanded', 'false');
}
lbExhibitBtn?.addEventListener('click', e => {
  e.stopPropagation();
  if (!me.id) { openAuthModal(); return; }
  const willOpen = !lbExhibitMenu.classList.contains('open');
  closeLbExhibitMenu();
  if (!willOpen) return;
  lbExhibitMenu.classList.add('open');
  lbExhibitBtn.classList.add('open');
  lbExhibitBtn.setAttribute('aria-expanded', 'true');
  renderLbExhibitMenu();
});
document.addEventListener('click', e => { if (!lbExhibitWrap.contains(e.target)) closeLbExhibitMenu(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeLbExhibitMenu(); });

// Fills in every piece of the shared lightbox/artwork markup from a
// submission row. Used both by openLightbox() below (the in-context modal
// on project.html/profile.html) and directly by artwork.js on the
// standalone /artworks/{id} page, which reuses this same markup inline
// (no modal chrome, nothing to open/close) so a single implementation
// backs both surfaces.
// Writes just the editable text details (title, material, completed date,
// statement, link) plus the image alt into the shared caption markup. Split
// out of populateLightboxContent so the "Edit" save path can re-render these
// in place without re-fetching comments/likes/artist details.
function applyArtDetailsToCaption(sub) {
  lbImg.alt = sub.art_title
    ? tr('artworkThumbAlt', { title: sub.art_title, name: sub.author_name || tr('anonymous') })
    : tr('artworkImgAltFallback', { name: sub.author_name || tr('anonymous') });
  document.getElementById('lightbox-cap-title').textContent = sub.art_title || '';
  document.getElementById('lightbox-cap-meta').textContent = [
    sub.art_material || null,
    sub.art_completed_date ? fmtCompletedYear(sub.art_completed_date) : null,
  ].filter(Boolean).join(' · ');
  renderLightboxPieceNote(sub);
  document.getElementById('lightbox-cap-desc').textContent = sub.art_description || '';
  const linkEl = document.getElementById('lightbox-cap-link');
  const href = sub.art_link ? safeHref(sub.art_link) : null;
  if (href) { linkEl.textContent = sub.art_link; linkEl.href = href; }
  else { linkEl.textContent = ''; linkEl.removeAttribute('href'); }
}

// Opened from a mosaic cell holding a PIECE of this artwork: say which
// piece (row/column of the n×n cut) under the title, with a mini grid
// marking it (supabase_mosaic_pieces.sql). The element is made here, once,
// rather than in every page copy of the caption markup.
function renderLightboxPieceNote(sub) {
  let el = document.getElementById('lightbox-cap-piece');
  if (!el) {
    el = document.createElement('div'); el.id = 'lightbox-cap-piece';
    document.getElementById('lightbox-cap-meta').insertAdjacentElement('afterend', el);
  }
  el.textContent = '';
  const piece = sub.piece;
  if (!piece || !(piece.n > 1)) { el.style.display = 'none'; return; }
  const grid = document.createElement('span'); grid.className = 'lb-piece-grid';
  grid.style.gridTemplateColumns = `repeat(${piece.n}, 1fr)`;
  for (let i = 0; i < piece.n * piece.n; i++) {
    const cell = document.createElement('i');
    if (i === piece.row * piece.n + piece.col) cell.className = 'on';
    grid.appendChild(cell);
  }
  const text = document.createElement('span');
  text.textContent = tr('pieceOfArtwork', { row: piece.row + 1, col: piece.col + 1, n: piece.n });
  el.append(grid, text);
  el.style.display = '';
}

// "12/49 pieces in the campaign mosaic (24%)" for a cut artwork — one
// small query per open (supabase_mosaic_pieces.sql), in the popup and on
// the standalone artwork page alike. artwork.html carries the element;
// the other pages get it made here, under the piece note.
// Who holds this artwork's medals. Built in JS rather than added to the
// lightbox markup because that markup is duplicated across 14 pages — the
// piece-usage row above does the same for the same reason.
//
// Additive: no SQL applied, no records, or a request that fails leaves the
// block hidden and the rest of the lightbox untouched.
const LB_MEDAL_ICONS = ['\u{1F947}', '\u{1F948}', '\u{1F949}'];
// Same shape the game screen uses, so a time reads the same everywhere.
function lbFmtMs(ms) {
  const total = Math.max(0, Number(ms) || 0) / 1000;
  if (total < 60) return tr('gameDurSec', { s: total.toFixed(2) });
  const m = Math.floor(total / 60);
  return tr('gameDurMin', { m, s: (total - m * 60).toFixed(2) });
}
// "Play this artwork" — the game page takes ?artwork= and opens the start
// dialog for it. Shown only when the game is on AND at least one piece of
// this artwork is actually sitting in a mosaic; without pieces there is
// nothing to hunt, and the game page would only be able to apologise.
// Built here rather than in markup because the lightbox markup is copied
// across 14 pages.
async function renderLightboxPlay(sub, usage) {
  const actions = document.querySelector('.lightbox-actions');
  if (!actions) return;
  let btn = document.getElementById('lb-play-btn');
  if (!btn) {
    btn = document.createElement('a');
    btn.id = 'lb-play-btn';
    btn.className = 'lb-action-btn';
    const ico = document.createElement('span'); ico.className = 'icon';
    const label = document.createElement('span'); label.id = 'lb-play-label';
    btn.append(ico, label);
    actions.insertBefore(btn, document.getElementById('lb-delete-btn'));
  }
  btn.style.display = 'none';
  const id = sub.parent_id != null ? sub.parent_id : sub.id;
  if (!id) return;
  let u = usage;
  // usage is only handed in for a whole artwork; a piece opened from the
  // campaign grid needs its parent looked up.
  if (u == null && sub.parent_id != null && typeof fetchPieceUsage === 'function') {
    u = await fetchPieceUsage(id);
  }
  if (!u || !(u.placed > 0)) return;
  let on = true;
  try { on = (await getSiteSettings()).gameEnabled !== false; } catch (e) {}
  if (!on || lbCurrentSub !== sub) return;
  document.getElementById('lb-play-label').textContent = tr('lbPlayGame');
  btn.href = `/${CURRENT_LANG}/game?artwork=${encodeURIComponent(id)}`;
  btn.style.display = '';
}
// "Color this artwork" — the coloring page takes ?artwork=. Shown when the
// coloring game is on and the artist has not opted this artwork out; the
// page itself says so if the picture cannot be made into a board.
async function renderLightboxColoring(sub) {
  const actions = document.querySelector('.lightbox-actions');
  if (!actions) return;
  let btn = document.getElementById('lb-color-btn');
  if (!btn) {
    btn = document.createElement('a');
    btn.id = 'lb-color-btn';
    btn.className = 'lb-action-btn';
    const ico = document.createElement('span'); ico.className = 'icon';
    const label = document.createElement('span'); label.id = 'lb-color-label';
    btn.append(ico, label);
    actions.insertBefore(btn, document.getElementById('lb-delete-btn'));
  }
  btn.style.display = 'none';
  const id = sub.parent_id != null ? sub.parent_id : sub.id;
  if (!id || sub.coloring_opt_out) return;
  let on = true;
  try { on = (await getSiteSettings()).pixelGameEnabled !== false; } catch (e) {}
  if (!on || lbCurrentSub !== sub) return;
  document.getElementById('lb-color-label').textContent = tr('lbColorGame');
  btn.href = `/${CURRENT_LANG}/coloring?artwork=${encodeURIComponent(id)}`;
  btn.style.display = '';
}
async function renderLightboxMedals(sub) {
  let el = document.getElementById('lightboxMedals');
  if (!el) {
    el = document.createElement('div'); el.id = 'lightboxMedals'; el.className = 'lb-medals';
    // On the picture, bottom right — the records belong to the artwork you
    // are looking at, and the caption column is already a long read. Same
    // corner treatment as the zoom toolbar so it stays legible over a
    // bright image.
    const stage = document.getElementById('lightboxStage') || document.getElementById('artworkStage');
    if (!stage) return;
    stage.appendChild(el);
  }
  el.style.display = 'none'; el.textContent = '';
  // A piece has no records of its own — its artwork does.
  const id = sub.parent_id != null ? sub.parent_id : sub.id;
  if (!id) return;
  let rows = null;
  try {
    const { data, error } = await sb.rpc('game_artwork_medals', { p_artwork_id: id });
    if (error) {
      if (error.code !== 'PGRST202' && error.code !== '42883') console.error('load artwork medals error:', error);
      return;
    }
    rows = data;
  } catch (e) { console.error('load artwork medals threw:', e); return; }
  if (!Array.isArray(rows) || !rows.length) return;
  if (lbCurrentSub !== sub) return;   // another artwork opened while this was in flight

  const head = document.createElement('div');
  head.className = 'lb-medals-head';
  head.textContent = tr('lbMedalsHead');
  el.appendChild(head);
  for (const r of rows) {
    const rank = Number(r.rank) || 1;
    const row = document.createElement('div');
    row.className = 'lb-medal-row';
    const ico = document.createElement('span');
    ico.className = 'lb-medal-ico';
    ico.textContent = LB_MEDAL_ICONS[rank - 1] || '';
    const name = document.createElement('a');
    name.className = 'lb-medal-name';
    name.href = profileUrl(r.username || r.user_id);
    name.textContent = r.username || tr('anonymous');
    const time = document.createElement('span');
    time.className = 'lb-medal-time';
    time.textContent = lbFmtMs(r.elapsed_ms);
    row.append(ico, name, time);
    el.appendChild(row);
  }
  el.style.display = '';
}
async function renderLightboxPieceUsage(sub) {
  let el = document.getElementById('artworkPieceUsage');
  if (!el) {
    el = document.createElement('div'); el.id = 'artworkPieceUsage'; el.className = 'piece-usage';
    const anchor = document.getElementById('lightbox-cap-piece') || document.getElementById('lightbox-cap-meta');
    anchor.insertAdjacentElement('afterend', el);
  }
  el.style.display = 'none'; el.textContent = '';
  if (sub.parent_id || typeof fetchPieceUsage !== 'function') return;
  const u = await fetchPieceUsage(sub.id);
  if (!u || lbCurrentSub !== sub) return; // nothing cut, or another artwork opened meanwhile
  const bar = document.createElement('span'); bar.className = 'piece-usage-bar';
  const fill = document.createElement('span'); fill.style.width = `${u.pct}%`; bar.appendChild(fill);
  const text = document.createElement('span');
  text.textContent = tr('artworkPieceUsage', { placed: u.placed, total: u.total, pct: u.pct });
  el.append(bar, text);
  el.style.display = '';
  return u;
}

// The like/comments/exhibit buttons are the same for everyone, but Edit,
// Delete, Report and admin "Remove from project" depend on who's signed in
// — and `me` is a mutable global that auth.js reassigns on every auth-state
// change (token refresh, tab refocus, a transient null session). Split out
// so it can be re-run on 'weavo:authchange' (below) if a lightbox is open
// when auth settles/flips, instead of being frozen to whatever `me` was the
// moment the lightbox opened.
function applyLightboxOwnerControls(sub) {
  const isOwner = !!(me.id && me.id === sub.author_id);
  lbReportBtn.style.display = isOwner ? 'none' : '';
  lbBlockBtn.style.display = isOwner ? 'none' : '';
  refreshLbBlockBtn();
  const deleteBtn = document.getElementById('lb-delete-btn');
  deleteBtn.style.display = isOwner ? '' : 'none';
  deleteBtn.onclick = () => deleteWeavoSubmission(sub);
  lbEditBtn.style.display = isOwner ? '' : 'none';
  const removeBtn = document.getElementById('lb-remove-btn');
  // A cut artwork opened from one of its pieces can be pulled out too —
  // unmatch_submission releases every piece of it.
  removeBtn.style.display = (me.isAdmin && !isOwner && (sub.project_id || sub.piece)) ? '' : 'none';
  removeBtn.onclick = () => removeSubmissionFromProject(sub);
}
document.addEventListener('weavo:authchange', () => {
  if (lbCurrentSub) applyLightboxOwnerControls(lbCurrentSub);
});

// The <img> is one element reused by every artwork, so assigning a new src
// does NOT clear the old picture — the browser keeps painting the previous
// artwork until the new bytes arrive. On a big original that is seconds of
// showing the wrong piece, and it reads as "the lightbox opened the thing I
// clicked before".
//
// So: drop the old picture first, put the 480px thumbnail up immediately
// (the grid that was just clicked already has it cached, so this is the
// same frame), and swap in the original only once it has fully decoded in
// a detached Image. The swap is then instant — the bytes are already in the
// cache — and every frame in between shows the RIGHT artwork, just softer.
// Artworks from before thumbnails existed have no thumb_url; those show the
// empty placeholder until the original lands, which is still better than
// the previous picture.
let lbImgToken = 0;
function setLightboxImage(sub) {
  const token = ++lbImgToken;
  const full = sub.image_url ? cdnUrl(sub.image_url) : null;
  const thumb = sub.thumb_url ? cdnUrl(sub.thumb_url) : null;
  // Whatever happens next, the previous artwork stops being on screen now.
  lbImg.removeAttribute('src');
  lbImg.classList.add('lb-img-loading');
  const settle = () => {
    if (token !== lbImgToken) return;
    lbImg.classList.remove('lb-img-loading');
  };
  if (!full) { if (thumb) lbImg.src = thumb; settle(); return; }
  if (thumb && thumb !== full) lbImg.src = thumb;
  const pre = new Image();
  pre.onload = () => {
    if (token !== lbImgToken) return;   // another artwork was opened meanwhile
    lbImg.src = full;
    settle();
  };
  pre.onerror = settle;                 // broken original: keep the thumbnail
  pre.src = full;
  // Already cached (a re-open, or the browser had it): no wait at all.
  if (pre.complete && pre.naturalWidth) { lbImg.src = full; settle(); }
}
function populateLightboxContent(sub) {
  lbCurrentSub = sub;
  setImgFullscreen(false); // a fresh piece always starts un-blown-up
  closeLbExhibitMenu();
  setLightboxImage(sub);
  applyArtDetailsToCaption(sub);
  renderLightboxPieceUsage(sub).then(u => renderLightboxPlay(sub, u));
  renderLightboxMedals(sub);
  renderLightboxColoring(sub);
  renderLightboxArtistCard(sub);
  loadLightboxArtistDetails(sub);
  setupLightboxArtistFollow(sub);
  document.getElementById('lightbox-caption').classList.remove('hidden');
  setupLightboxEngagement(sub);
  applyLightboxOwnerControls(sub);
  const commentsBtn = document.getElementById('lb-comments-btn');
  commentsBtn.classList.add('active');
  commentsBtn.setAttribute('aria-expanded', 'true');
  document.getElementById('lightbox-comments').classList.add('open');
  document.getElementById('lightbox-comment-input').value = '';
  loadLightboxComments(sub);
}
// The modal wrapper only exists on project.html/profile.html — absent on
// the standalone artwork page, which has nothing to open/close itself into.
const lbModal = document.getElementById('lightbox-modal');
function openLightbox(sub) {
  populateLightboxContent(sub);
  resetLbZoom();
  lbModal?.classList.add('open');
}
function closeLightbox() { setImgFullscreen(false); lbModal?.classList.remove('open'); }
window.closeLightbox = closeLightbox;
lbModal?.addEventListener('click', e => { if (e.target === e.currentTarget) closeLightbox(); });
lbStage.addEventListener('click', e => { if (e.target === lbStage) closeLightbox(); });
document.getElementById('lightbox-close')?.addEventListener('click', closeLightbox);
lbZoomInBtn.onclick = () => setLbZoom(lbScale + LB_ZOOM_STEP);
lbZoomOutBtn.onclick = () => setLbZoom(lbScale - LB_ZOOM_STEP);

// ---------- tap the image to fill the viewport ----------
// .img-fs goes on whichever element wraps the shared #lightboxStage markup:
// the modal on project/profile, or #artworkStage on the standalone page.
const lbFsHost = lbModal || document.getElementById('artworkStage');
let lbImgMoved = false; // true while panning a zoomed image, so the trailing click doesn't toggle
let lbClickTimer = null; // lets a genuine dblclick (zoom) pre-empt the single-click (fullscreen)
function isImgFullscreen() { return !!lbFsHost && lbFsHost.classList.contains('img-fs'); }
function setImgFullscreen(on) {
  if (!lbFsHost) return;
  clearTimeout(lbClickTimer); lbClickTimer = null; // drop any pending single-click toggle
  lbFsHost.classList.toggle('img-fs', on);
  document.body.classList.toggle('lb-img-fs-lock', on);
  if (!on) resetLbZoom();
}
lbImg.addEventListener('click', () => {
  if (lbImgMoved) { lbImgMoved = false; return; }
  if (lbClickTimer) return;
  lbClickTimer = setTimeout(() => { lbClickTimer = null; setImgFullscreen(!isImgFullscreen()); }, 200);
});
lbImg.addEventListener('dblclick', () => {
  clearTimeout(lbClickTimer); lbClickTimer = null;
  setLbZoom(lbScale > 1 ? 1 : 2.5);
});
// Capture phase so this runs before auth.js's window-level Escape handler
// (which would otherwise close the whole lightbox) — first Escape just drops
// out of the blown-up image.
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && isImgFullscreen()) { e.stopPropagation(); setImgFullscreen(false); }
}, true);
lbStage.addEventListener('wheel', e => {
  e.preventDefault();
  setLbZoom(lbScale + (e.deltaY < 0 ? LB_ZOOM_STEP : -LB_ZOOM_STEP));
}, { passive: false });

// drag-to-pan (mouse) when zoomed in
let lbDragging = false, lbStartX = 0, lbStartY = 0, lbOrigX = 0, lbOrigY = 0;
lbImg.addEventListener('mousedown', e => {
  lbImgMoved = false;
  if (lbScale <= LB_MIN_ZOOM) return;
  e.preventDefault();
  lbDragging = true;
  lbStartX = e.clientX; lbStartY = e.clientY;
  lbOrigX = lbX; lbOrigY = lbY;
  lbImg.classList.add('dragging');
});
addEventListener('mousemove', e => {
  if (!lbDragging) return;
  lbImgMoved = true;
  lbX = lbOrigX + (e.clientX - lbStartX);
  lbY = lbOrigY + (e.clientY - lbStartY);
  lbImg.style.transform = `translate(${lbX}px, ${lbY}px) scale(${lbScale})`;
});
addEventListener('mouseup', () => { lbDragging = false; lbImg.classList.remove('dragging'); });

// pinch-to-zoom / one-finger pan (touch)
function lbTouchDist(touches) {
  return Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
}
let lbPinchStartDist = 0, lbPinchStartScale = 1;
lbStage.addEventListener('touchstart', e => {
  lbImgMoved = false;
  if (e.touches.length === 2) {
    lbImgMoved = true; // a pinch is never a tap
    lbPinchStartDist = lbTouchDist(e.touches);
    lbPinchStartScale = lbScale;
  } else if (e.touches.length === 1 && lbScale > LB_MIN_ZOOM) {
    lbDragging = true;
    lbStartX = e.touches[0].clientX; lbStartY = e.touches[0].clientY;
    lbOrigX = lbX; lbOrigY = lbY;
    lbImg.classList.add('dragging');
  }
}, { passive: true });
lbStage.addEventListener('touchmove', e => {
  if (e.touches.length === 2 && lbPinchStartDist) {
    e.preventDefault();
    setLbZoom(lbPinchStartScale * (lbTouchDist(e.touches) / lbPinchStartDist));
  } else if (e.touches.length === 1 && lbDragging) {
    e.preventDefault();
    lbImgMoved = true;
    lbX = lbOrigX + (e.touches[0].clientX - lbStartX);
    lbY = lbOrigY + (e.touches[0].clientY - lbStartY);
    lbImg.style.transform = `translate(${lbX}px, ${lbY}px) scale(${lbScale})`;
  }
}, { passive: false });
lbStage.addEventListener('touchend', () => { lbDragging = false; lbPinchStartDist = 0; lbImg.classList.remove('dragging'); });

// ---------- lightbox likes ----------
// A like is the only artwork-engagement concept now — it also puts the
// piece in the liking user's profile "Liked" grid and the Collections
// add-artwork picker (see fetchLikedWeavoArt in common.js). There used to
// be a separate "save"/"Collect" button/table; the two were merged.
let lbEngagementRequestId = 0;
async function setupLightboxEngagement(sub) {
  const likeBtn = document.getElementById('lb-like-btn');
  const likeCountEl = document.getElementById('lb-like-count');
  const myRequest = ++lbEngagementRequestId;
  likeBtn.disabled = true;
  likeBtn.classList.remove('active');
  likeCountEl.textContent = '…';
  const { data: likes, error: likeErr } = await sb.from('mosaic_submission_likes').select('user_id').eq('submission_id', sub.id);
  if (myRequest !== lbEngagementRequestId) return; // a different piece was opened meanwhile
  const likeList = likeErr || !likes ? [] : likes;
  likeCountEl.textContent = likeList.length;
  likeBtn.classList.toggle('active', me.id ? likeList.some(l => l.user_id === me.id) : false);
  likeBtn.disabled = false;
  likeBtn.onclick = () => toggleSubmissionLike(sub.id, likeBtn, likeCountEl);
}
async function toggleSubmissionLike(submissionId, btn, countEl) {
  if (!me.id) { openAuthModal(); return; }
  const wasLiked = btn.classList.contains('active');
  btn.disabled = true;
  const { error } = wasLiked
    ? await sb.from('mosaic_submission_likes').delete().eq('submission_id', submissionId).eq('user_id', me.id)
    : await sb.from('mosaic_submission_likes').insert({ submission_id: submissionId, user_id: me.id });
  btn.disabled = false;
  if (error) { toast(tr('couldNotUpdateLike')); return; }
  btn.classList.toggle('active', !wasLiked);
  countEl.textContent = Number(countEl.textContent || 0) + (wasLiked ? -1 : 1);
}

// ---------- delete artwork (author only — permanent, unlike "remove from project" below) ----------
async function deleteWeavoSubmission(sub) {
  const proceed = await confirmDialog(
    tr('deleteArtworkMessage'),
    { title: tr('deleteArtworkTitle'), okLabel: tr('deleteLabel') }
  );
  if (!proceed) return;
  const { error: delErr } = await sb.from('mosaic_submissions').delete().eq('id', sub.id);
  if (delErr) { console.error('delete weavo submission error:', delErr); toast(tr('couldNotDeleteArtwork')); return; }
  if (sub.pixel_id) {
    // The FK on mosaic_pixels.submission_id already nulled itself out via
    // "on delete set null" — reset the rest of the claim here too, rather
    // than leaving the cell stuck until the 10-minute stale-claim sweep.
    // Permitted by the existing "claim and fill" pixels policy since only
    // the author (who's also the claimant) can reach this path now.
    const { error: pxErr } = await sb.from('mosaic_pixels')
      .update({ filled: false, submission_id: null, claimed_by: null, claimed_at: null })
      .eq('id', sub.pixel_id);
    if (pxErr) console.error('reset pixel after delete error:', pxErr);
  }
  closeLightbox();
  toast(tr('artworkDeleted'));
  if (typeof window.onSubmissionDeleted === 'function') window.onSubmissionDeleted(sub);
  // A cell may have just opened up — see if anything else in the pool fits it.
  if (sub.pixel_id) runPoolMatching().catch(err => console.error('pool matching after delete error:', err));
}

// ---------- admin: remove from project (returns the piece to its artist's pool instead of deleting it) ----------
async function removeSubmissionFromProject(sub) {
  const proceed = await confirmDialog(
    tr('removeFromProjectMessage'),
    { title: tr('removeFromProjectTitle'), okLabel: tr('removeFromProjectLabel') }
  );
  if (!proceed) return;
  const { error } = await sb.rpc('unmatch_submission', { p_submission_id: sub.id });
  if (error) { console.error('unmatch_submission error:', error); toast(tr('couldNotRemoveArtwork')); return; }
  closeLightbox();
  toast(tr('artworkRemovedFromProject'));
  if (typeof window.onSubmissionDeleted === 'function') window.onSubmissionDeleted(sub);
  runPoolMatching().catch(err => console.error('pool matching after unmatch error:', err));
}

// ---------- lightbox comments ----------
let lbCommentsRequestId = 0;
async function fetchWeavoComments(submissionId) {
  const { data, error } = await sb.from('mosaic_submission_comments')
    .select('id,submission_id,parent_id,author_id,author_name,author_avatar_url,body,created_at')
    .eq('submission_id', submissionId)
    .order('created_at', { ascending: true });
  if (error) { console.error('load weavo comments error:', error); return []; }
  return data || [];
}
async function loadLightboxComments(sub) {
  const myRequest = ++lbCommentsRequestId;
  const allComments = await fetchWeavoComments(sub.id);
  if (myRequest !== lbCommentsRequestId) return; // a different piece was opened meanwhile
  // A blocked commenter's whole thread (their replies too) drops out here —
  // see the myBlockedIds banner comment in common.js.
  const comments = allComments.filter(c => !isUserBlocked(c.author_id));
  document.getElementById('lb-comments-count').textContent = comments.length;
  renderCommentThread(document.getElementById('lightbox-comments-list'), comments);
}
function renderCommentThread(listEl, comments) {
  listEl.innerHTML = '';
  const topLevel = comments.filter(c => !c.parent_id);
  if (!topLevel.length) {
    const empty = document.createElement('div');
    empty.className = 'lb-comments-empty'; empty.textContent = tr('noCommentsYet');
    listEl.appendChild(empty);
    return;
  }
  const repliesByParent = new Map();
  for (const c of comments) {
    if (!c.parent_id) continue;
    if (!repliesByParent.has(c.parent_id)) repliesByParent.set(c.parent_id, []);
    repliesByParent.get(c.parent_id).push(c);
  }
  for (const c of topLevel) {
    const el = commentItemEl(c, false);
    const repliesWrap = el.querySelector('.lbc-replies');
    for (const r of (repliesByParent.get(c.id) || [])) repliesWrap.appendChild(commentItemEl(r, true));
    listEl.appendChild(el);
  }
}
function commentItemEl(c, isReply) {
  const el = document.createElement('div');
  el.className = 'lb-comment' + (isReply ? ' lb-comment-reply' : '');
  const head = document.createElement('div'); head.className = 'lbc-head';
  head.appendChild(miniAvatarEl(c.author_name, c.author_avatar_url, c.author_id));
  const nameBtn = document.createElement('a');
  nameBtn.className = 'lbc-author'; nameBtn.textContent = c.author_name || tr('anonymous');
  nameBtn.href = profileUrl(c.author_id);
  head.appendChild(nameBtn);
  const time = document.createElement('span'); time.className = 'lbc-time';
  time.textContent = fmtShortDate(c.created_at);
  head.appendChild(time);
  const canManage = me.id && (me.id === c.author_id || (lbCurrentSub && me.id === lbCurrentSub.author_id));
  const canReport = me.id && me.id !== c.author_id;
  if (canManage || canReport) {
    const headActions = document.createElement('div'); headActions.className = 'lbc-head-actions';
    if (canReport) {
      const report = document.createElement('button');
      report.type = 'button'; report.className = 'lbc-report'; report.textContent = tr('reportBtnLabel');
      report.setAttribute('aria-label', tr('reportAriaLabel_comment'));
      report.onclick = () => openReportModal('comment', c.id);
      headActions.appendChild(report);
      const block = document.createElement('button');
      block.type = 'button'; block.className = 'lbc-report lbc-block';
      const setBlockLabel = () => {
        const blocked = isUserBlocked(c.author_id);
        block.textContent = tr(blocked ? 'unblockLabel' : 'blockLabel');
        block.setAttribute('aria-label', tr(blocked ? 'unblockAriaLabel_comment' : 'blockAriaLabel_comment'));
      };
      setBlockLabel();
      block.onclick = async () => {
        await toggleUserBlock(c.author_id, block);
        setBlockLabel();
        refreshLbBlockBtn();
        if (lbCurrentSub) loadLightboxComments(lbCurrentSub);
      };
      headActions.appendChild(block);
    }
    if (canManage) {
      const del = document.createElement('button');
      del.type = 'button'; del.className = 'lbc-delete'; del.textContent = tr('deleteLabel');
      del.onclick = () => deleteWeavoComment(c.id);
      headActions.appendChild(del);
    }
    head.appendChild(headActions);
  }
  el.appendChild(head);
  const body = document.createElement('div'); body.className = 'lbc-body'; body.textContent = c.body;
  el.appendChild(body);
  if (!isReply) {
    const replyBtn = document.createElement('button');
    replyBtn.type = 'button'; replyBtn.className = 'lbc-reply-btn'; replyBtn.textContent = tr('replyLabel');
    replyBtn.onclick = () => toggleReplyForm(el, c.id);
    el.appendChild(replyBtn);
    const repliesWrap = document.createElement('div'); repliesWrap.className = 'lbc-replies';
    el.appendChild(repliesWrap);
  }
  return el;
}
function toggleReplyForm(commentEl, parentId) {
  const existing = commentEl.querySelector('.lbc-reply-form');
  if (existing) { existing.remove(); return; }
  if (!me.id) { openAuthModal(); return; }
  const form = document.createElement('div'); form.className = 'lbc-reply-form';
  const textarea = document.createElement('textarea');
  textarea.placeholder = tr('writeAReplyPlaceholder'); textarea.maxLength = 1000;
  const postBtn = document.createElement('button');
  postBtn.type = 'button'; postBtn.textContent = tr('replyLabel');
  postBtn.onclick = async () => {
    const body = textarea.value.trim();
    if (!body || !lbCurrentSub) return;
    postBtn.disabled = true;
    const comment = await postWeavoComment(lbCurrentSub.id, body, parentId);
    postBtn.disabled = false;
    if (comment) loadLightboxComments(lbCurrentSub);
  };
  postOnShiftEnter(textarea, postBtn); // same shortcut as the comment box
  form.append(textarea, postBtn);
  commentEl.insertBefore(form, commentEl.querySelector('.lbc-replies'));
  textarea.focus();
}
async function postWeavoComment(submissionId, body, parentId) {
  if (!me.id) { openAuthModal(); return null; }
  const { data, error } = await sb.from('mosaic_submission_comments').insert({
    submission_id: submissionId, parent_id: parentId || null,
    author_id: me.id, author_name: me.username || tr('anonymous'), author_avatar_url: me.avatar || null, body
  }).select().single();
  if (error) { console.error('post weavo comment error:', error); toast(tr('couldNotPostComment')); return null; }
  return data;
}
async function deleteWeavoComment(commentId) {
  const { error } = await sb.from('mosaic_submission_comments').delete().eq('id', commentId);
  if (error) { toast(tr('couldNotDeleteComment')); return; }
  if (lbCurrentSub) loadLightboxComments(lbCurrentSub);
}
document.getElementById('lb-comments-btn').onclick = () => {
  const btn = document.getElementById('lb-comments-btn');
  const panel = document.getElementById('lightbox-comments');
  const open = panel.classList.toggle('open');
  btn.classList.toggle('active', open);
  btn.setAttribute('aria-expanded', String(open));
};
// Shift+Enter posts, a plain Enter still breaks the line (these are
// textareas, and a comment is often more than one line).
//
// isComposing / keyCode 229 is the IME guard, and it matters here: typing
// Korean, the Enter that confirms a candidate arrives as a keydown too, so
// without this a half-finished word would be sent the moment the user
// pressed Enter to accept it. keyCode is the fallback for browsers that
// don't set isComposing.
//
// It clicks the button rather than calling the handler, so a disabled button
// (a post already in flight) swallows the repeat for free.
function postOnShiftEnter(textarea, button) {
  textarea.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || !e.shiftKey || e.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    button.click();
  });
}
postOnShiftEnter(
  document.getElementById('lightbox-comment-input'),
  document.getElementById('lightbox-comment-post'),
);
document.getElementById('lightbox-comment-post').onclick = async () => {
  if (!me.id) { openAuthModal(); return; }
  if (!lbCurrentSub) return;
  const input = document.getElementById('lightbox-comment-input');
  const body = input.value.trim();
  if (!body) return;
  const btn = document.getElementById('lightbox-comment-post');
  btn.disabled = true;
  const comment = await postWeavoComment(lbCurrentSub.id, body, null);
  btn.disabled = false;
  if (comment) { input.value = ''; loadLightboxComments(lbCurrentSub); }
};
