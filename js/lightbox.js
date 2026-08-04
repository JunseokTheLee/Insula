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
// Lets you save (follow) the artist straight from their artwork, without
// navigating to their profile page first. Hidden for your own artwork and
// when the card itself is hidden (no author_id — see renderLightboxArtistCard).
let lbArtistSaveToken = 0;
async function setupLightboxArtistSave(sub) {
  const btn = document.getElementById('lightbox-artist-save-btn');
  if (!btn) return; // not every page embedding the lightbox markup has this button
  const myToken = ++lbArtistSaveToken;
  if (!sub.author_id || sub.author_id === me.id) { btn.style.display = 'none'; return; }
  btn.style.display = '';
  btn.disabled = false;
  btn.classList.remove('saving');
  btn.textContent = tr('saveLabel');
  btn.onclick = () => toggleUserSave(sub.author_id, btn);
  if (!me.id) return;
  const isSaving = await fetchIsSaving(me.id, sub.author_id);
  if (myToken !== lbArtistSaveToken) return; // a newer lightbox item opened while this was in flight
  btn.classList.toggle('saving', isSaving);
  btn.textContent = isSaving ? tr('savingLabel') : tr('saveLabel');
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

// Fills in every piece of the shared lightbox/artwork markup from a
// submission row. Used both by openLightbox() below (the in-context modal
// on project.html/profile.html) and directly by artwork.js on the
// standalone /artworks/{id} page, which reuses this same markup inline
// (no modal chrome, nothing to open/close) so a single implementation
// backs both surfaces.
function populateLightboxContent(sub) {
  lbCurrentSub = sub;
  lbImg.src = cdnUrl(sub.image_url);
  lbImg.alt = sub.art_title
    ? tr('artworkThumbAlt', { title: sub.art_title, name: sub.author_name || tr('anonymous') })
    : tr('artworkImgAltFallback', { name: sub.author_name || tr('anonymous') });
  document.getElementById('lightbox-cap-title').textContent = sub.art_title || '';
  document.getElementById('lightbox-cap-meta').textContent = [
    sub.art_material || null,
    sub.art_completed_date ? fmtCompletedDate(sub.art_completed_date) : null,
  ].filter(Boolean).join(' · ');
  renderLightboxArtistCard(sub);
  loadLightboxArtistDetails(sub);
  setupLightboxArtistSave(sub);
  document.getElementById('lightbox-cap-desc').textContent = sub.art_description || '';
  const linkEl = document.getElementById('lightbox-cap-link');
  const href = sub.art_link ? safeHref(sub.art_link) : null;
  if (href) { linkEl.textContent = sub.art_link; linkEl.href = href; }
  else { linkEl.textContent = ''; linkEl.removeAttribute('href'); }
  document.getElementById('lightbox-caption').classList.remove('hidden');
  setupLightboxEngagement(sub);
  const deleteBtn = document.getElementById('lb-delete-btn');
  deleteBtn.style.display = me.id === sub.author_id ? '' : 'none';
  deleteBtn.onclick = () => deleteWeavoSubmission(sub);
  const removeBtn = document.getElementById('lb-remove-btn');
  removeBtn.style.display = (me.isAdmin && me.id !== sub.author_id && sub.project_id) ? '' : 'none';
  removeBtn.onclick = () => removeSubmissionFromProject(sub);
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
function closeLightbox() { lbModal?.classList.remove('open'); }
window.closeLightbox = closeLightbox;
lbModal?.addEventListener('click', e => { if (e.target === e.currentTarget) closeLightbox(); });
lbStage.addEventListener('click', e => { if (e.target === lbStage) closeLightbox(); });
document.getElementById('lightbox-close')?.addEventListener('click', closeLightbox);
lbZoomInBtn.onclick = () => setLbZoom(lbScale + LB_ZOOM_STEP);
lbZoomOutBtn.onclick = () => setLbZoom(lbScale - LB_ZOOM_STEP);
lbImg.addEventListener('dblclick', () => setLbZoom(lbScale > 1 ? 1 : 2.5));
lbStage.addEventListener('wheel', e => {
  e.preventDefault();
  setLbZoom(lbScale + (e.deltaY < 0 ? LB_ZOOM_STEP : -LB_ZOOM_STEP));
}, { passive: false });

// drag-to-pan (mouse) when zoomed in
let lbDragging = false, lbStartX = 0, lbStartY = 0, lbOrigX = 0, lbOrigY = 0;
lbImg.addEventListener('mousedown', e => {
  if (lbScale <= LB_MIN_ZOOM) return;
  e.preventDefault();
  lbDragging = true;
  lbStartX = e.clientX; lbStartY = e.clientY;
  lbOrigX = lbX; lbOrigY = lbY;
  lbImg.classList.add('dragging');
});
addEventListener('mousemove', e => {
  if (!lbDragging) return;
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
  if (e.touches.length === 2) {
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
    lbX = lbOrigX + (e.touches[0].clientX - lbStartX);
    lbY = lbOrigY + (e.touches[0].clientY - lbStartY);
    lbImg.style.transform = `translate(${lbX}px, ${lbY}px) scale(${lbScale})`;
  }
}, { passive: false });
lbStage.addEventListener('touchend', () => { lbDragging = false; lbPinchStartDist = 0; lbImg.classList.remove('dragging'); });

// ---------- lightbox likes & saves ----------
let lbEngagementRequestId = 0;
async function setupLightboxEngagement(sub) {
  const likeBtn = document.getElementById('lb-like-btn');
  const likeCountEl = document.getElementById('lb-like-count');
  const saveBtn = document.getElementById('lb-save-btn');
  const myRequest = ++lbEngagementRequestId;
  likeBtn.disabled = true; saveBtn.disabled = true;
  likeBtn.classList.remove('active'); saveBtn.classList.remove('active');
  likeCountEl.textContent = '…';
  const [{ data: likes, error: likeErr }, saveRes] = await Promise.all([
    sb.from('mosaic_submission_likes').select('user_id').eq('submission_id', sub.id),
    me.id
      ? sb.from('mosaic_submission_saves').select('user_id').eq('submission_id', sub.id).eq('user_id', me.id).maybeSingle()
      : Promise.resolve({ data: null })
  ]);
  if (myRequest !== lbEngagementRequestId) return; // a different piece was opened meanwhile
  const likeList = likeErr || !likes ? [] : likes;
  likeCountEl.textContent = likeList.length;
  likeBtn.classList.toggle('active', me.id ? likeList.some(l => l.user_id === me.id) : false);
  saveBtn.classList.toggle('active', !!(saveRes && saveRes.data));
  likeBtn.disabled = false; saveBtn.disabled = false;
  likeBtn.onclick = () => toggleSubmissionLike(sub.id, likeBtn, likeCountEl);
  saveBtn.onclick = () => toggleSubmissionSave(sub.id, saveBtn);
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
async function toggleSubmissionSave(submissionId, btn) {
  if (!me.id) { openAuthModal(); return; }
  const wasSaved = btn.classList.contains('active');
  btn.disabled = true;
  const { error } = wasSaved
    ? await sb.from('mosaic_submission_saves').delete().eq('submission_id', submissionId).eq('user_id', me.id)
    : await sb.from('mosaic_submission_saves').insert({ submission_id: submissionId, user_id: me.id });
  btn.disabled = false;
  if (error) { toast(tr('couldNotUpdateCollection')); return; }
  btn.classList.toggle('active', !wasSaved);
  toast(wasSaved ? tr('removedFromCollection') : tr('collectedToast'));
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
  const comments = await fetchWeavoComments(sub.id);
  if (myRequest !== lbCommentsRequestId) return; // a different piece was opened meanwhile
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
  if (canManage) {
    const del = document.createElement('button');
    del.type = 'button'; del.className = 'lbc-delete'; del.textContent = tr('deleteLabel');
    del.onclick = () => deleteWeavoComment(c.id);
    head.appendChild(del);
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
  form.append(textarea, postBtn);
  commentEl.insertBefore(form, commentEl.querySelector('.lbc-replies'));
  textarea.focus();
}
async function postWeavoComment(submissionId, body, parentId) {
  if (!me.id) { openAuthModal(); return null; }
  const { data, error } = await sb.from('mosaic_submission_comments').insert({
    submission_id: submissionId, parent_id: parentId || null,
    author_id: me.id, author_name: me.username || me.name, author_avatar_url: me.avatar || null, body
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
