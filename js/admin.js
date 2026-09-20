// Admin page (/{lang}/admin): report queue, campaign list with per-campaign
// delete, the admin roster, usage and visitor statistics. Everything here is gated twice — the page
// hides itself unless me.isAdmin, and every read/write it makes is already
// admin-only at the database (reports RLS, delete_mosaic_project RPC).
// Deliberately offers NO way to delete artwork, let alone many at once (see
// CLAUDE.md §13): reported items link out to their own page, where the
// existing one-piece-at-a-time delete lives. Needs common.js and auth.js.
"use strict";

function adminShow(id, on) { const el = document.getElementById(id); if (el) el.style.display = on ? '' : 'none'; }
function adminDate(iso) {
  return new Date(iso).toLocaleDateString(CURRENT_LANG === 'ko' ? 'ko-KR' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}
function adminActionBtn(label, onClick, cls) {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'admin-btn' + (cls ? ' ' + cls : ''); b.textContent = label; b.onclick = onClick;
  return b;
}

// ---------- reports ----------
async function loadAdminReports() {
  const showAll = document.getElementById('adminReportsShowAll').checked;
  let q = sb.from('reports')
    .select('id,reporter_id,target_type,target_id,reason,details,status,created_at')
    .order('created_at', { ascending: false }).limit(200);
  if (!showAll) q = q.eq('status', 'open');
  const { data, error } = await q;
  if (error) { console.error('load reports error:', error); toast(tr('adminLoadError')); return; }
  const reports = data || [];

  // Resolve what each report points at so the row can show and link the
  // target. Deleted targets simply come back empty and are labelled as such.
  const ids = t => [...new Set(reports.filter(r => r.target_type === t).map(r => r.target_id))];
  const subIds = ids('submission').map(Number).filter(Number.isFinite);
  const comIds = ids('comment').map(Number).filter(Number.isFinite);
  const profIds = ids('profile');
  const reporterIds = [...new Set(reports.map(r => r.reporter_id))];
  const [subs, coms, profs, reporters] = await Promise.all([
    subIds.length ? sb.from('mosaic_submissions').select('id,art_title,author_name,thumb_url,image_url').in('id', subIds) : { data: [] },
    comIds.length ? sb.from('mosaic_submission_comments').select('id,submission_id,author_name,body').in('id', comIds) : { data: [] },
    profIds.length ? sb.from('profiles').select('id,username,avatar_url').in('id', profIds) : { data: [] },
    reporterIds.length ? sb.from('profiles').select('id,username').in('id', reporterIds) : { data: [] },
  ]);
  const subBy = new Map((subs.data || []).map(s => [String(s.id), s]));
  const comBy = new Map((coms.data || []).map(c => [String(c.id), c]));
  const profBy = new Map((profs.data || []).map(p => [p.id, p]));
  const reporterBy = new Map((reporters.data || []).map(p => [p.id, p]));

  const list = document.getElementById('adminReports');
  list.innerHTML = '';
  adminShow('adminReportsEmpty', reports.length === 0);
  for (const r of reports) list.appendChild(adminReportRowEl(r, { subBy, comBy, profBy, reporterBy }));
}

function adminReportRowEl(r, { subBy, comBy, profBy, reporterBy }) {
  const row = document.createElement('div');
  row.className = 'admin-row admin-report' + (r.status !== 'open' ? ' is-handled' : '');

  // Target: thumbnail/label + link to the page where it can be reviewed
  // (and, if warranted, deleted one piece at a time).
  const target = document.createElement('div'); target.className = 'admin-target';
  let href = null, label = tr('adminTargetMissing'), thumb = null;
  if (r.target_type === 'submission') {
    const s = subBy.get(String(r.target_id));
    if (s) { href = artworkUrl(s.id); label = `${s.art_title || tr('untitledArtwork')} — ${s.author_name || tr('anonymous')}`; thumb = s.thumb_url || s.image_url; }
  } else if (r.target_type === 'comment') {
    const c = comBy.get(String(r.target_id));
    if (c) { href = artworkUrl(c.submission_id); label = `${c.author_name || tr('anonymous')}: ${c.body.slice(0, 120)}`; }
  } else if (r.target_type === 'profile') {
    const p = profBy.get(r.target_id);
    if (p) { href = profileUrl(p.username || p.id); label = p.username || tr('anonymous'); thumb = p.avatar_url; }
  }
  const typeTag = document.createElement('span'); typeTag.className = 'admin-badge'; typeTag.textContent = tr('adminTarget_' + r.target_type);
  target.appendChild(typeTag);
  if (thumb) { const img = document.createElement('img'); img.className = 'admin-thumb'; img.src = cdnUrl(thumb); img.alt = ''; target.appendChild(img); }
  const link = document.createElement(href ? 'a' : 'span'); link.className = 'admin-target-label';
  if (href) { link.href = href; link.target = '_blank'; link.rel = 'noopener'; }
  link.textContent = label;
  target.appendChild(link);

  // Why + who + when + status
  const meta = document.createElement('div'); meta.className = 'admin-meta';
  const reason = document.createElement('div'); reason.className = 'admin-reason';
  reason.textContent = tr('reportReason_' + r.reason);
  if (r.details) { const d = document.createElement('span'); d.className = 'admin-details'; d.textContent = ' — ' + r.details; reason.appendChild(d); }
  const who = document.createElement('div'); who.className = 'admin-sub';
  const rep = reporterBy.get(r.reporter_id);
  who.textContent = `${tr('adminReportedBy', { name: (rep && rep.username) || tr('anonymous') })} · ${adminDate(r.created_at)}`;
  const status = document.createElement('span'); status.className = 'admin-badge admin-status admin-status-' + r.status;
  status.textContent = tr('adminStatus_' + r.status);
  who.appendChild(document.createTextNode(' · ')); who.appendChild(status);
  meta.append(reason, who);

  // Status actions only — never a delete button here.
  const actions = document.createElement('div'); actions.className = 'admin-actions';
  if (r.status === 'open') {
    actions.appendChild(adminActionBtn(tr('adminMarkResolved'), () => setAdminReportStatus(r.id, 'resolved'), 'primary'));
    actions.appendChild(adminActionBtn(tr('adminMarkDismissed'), () => setAdminReportStatus(r.id, 'dismissed')));
  } else {
    actions.appendChild(adminActionBtn(tr('adminReopen'), () => setAdminReportStatus(r.id, 'open')));
  }

  row.append(target, meta, actions);
  return row;
}

async function setAdminReportStatus(id, status) {
  const { error } = await sb.from('reports').update({ status }).eq('id', id);
  if (error) { console.error('update report error:', error); toast(tr('adminCouldNotUpdateReport')); return; }
  toast(tr('adminReportUpdated'));
  loadAdminReports();
  loadAdminReportsBadge().catch(err => console.error('report badge error:', err));
}

// ---------- campaigns ----------
const ADMIN_CAMPAIGN_COLS = 'id,title,description,width,height,created_at,is_archived,version_number,grid_image_url,preview_image_url';
async function fetchAdminCampaignRows() {
  return sb.from('mosaic_projects').select(ADMIN_CAMPAIGN_COLS).order('created_at', { ascending: false });
}
async function loadAdminCampaigns() {
  const [{ data: projects, error }, { data: placed }] = await Promise.all([
    fetchAdminCampaignRows(),
    sb.from('mosaic_submissions').select('project_id').not('project_id', 'is', null),
  ]);
  if (error) { console.error('load campaigns error:', error); toast(tr('adminLoadError')); return; }
  const filledBy = new Map();
  for (const s of placed || []) filledBy.set(s.project_id, (filledBy.get(s.project_id) || 0) + 1);

  const list = document.getElementById('adminCampaigns');
  list.innerHTML = '';
  adminShow('adminCampaignsEmpty', !(projects && projects.length));
  for (const p of projects || []) {
    const row = document.createElement('div'); row.className = 'admin-row admin-campaign' + (p.is_archived ? ' is-archived' : '');
    const main = document.createElement('div'); main.className = 'admin-meta';
    const title = document.createElement('a'); title.className = 'admin-target-label'; title.href = projectUrl(p.id); title.textContent = p.title;
    if (p.is_archived) { const b = document.createElement('span'); b.className = 'admin-badge'; b.textContent = `${tr('archivedBadge')} v${p.version_number}`; title.appendChild(document.createTextNode(' ')); title.appendChild(b); }
    const sub = document.createElement('div'); sub.className = 'admin-sub';
    sub.textContent = `${tr('adminCells', { w: p.width, h: p.height, filled: filledBy.get(p.id) || 0 })} · ${tr('adminCreatedOn', { date: adminDate(p.created_at) })} · ${p.grid_image_url ? tr('adminGridImageYes') : tr('adminGridImageNo')} · ${p.preview_image_url ? tr('adminPreviewImageYes') : tr('adminPreviewImageNo')}`;
    main.append(title, sub);
    const actions = document.createElement('div'); actions.className = 'admin-actions';
    // Older campaigns (pre grid-image cache) get a one-off "create" button;
    // new and reshaped ones already have theirs.
    if (!p.grid_image_url) actions.appendChild(adminActionBtn(tr('adminGridImageBtn'), e => createAdminGridImage(p, e.currentTarget)));
    // The share card can always be (re)made: "create" for campaigns from
    // before it existed, "recreate" after the previewContrast option changed.
    actions.appendChild(adminActionBtn(tr(p.preview_image_url ? 'adminPreviewImageRedoBtn' : 'adminPreviewImageBtn'), e => createAdminPreviewImage(p, e.currentTarget)));
    // Archived iterations can't be deleted on their own (the RPC refuses) —
    // they go away with their live campaign.
    if (!p.is_archived) {
      actions.appendChild(adminActionBtn(tr('adminEditLabel'), () => openAdminEditCampaign(p)));
      actions.appendChild(adminActionBtn(tr('deleteLabel'), () => deleteAdminCampaign(p), 'danger'));
    }
    row.append(main, actions);
    list.appendChild(row);
  }
}

async function deleteAdminCampaign(p) {
  const proceed = await confirmDialog(
    tr('adminDeleteCampaignMessage', { title: p.title }),
    { title: tr('adminDeleteCampaignTitle'), okLabel: tr('deleteLabel'), confirmText: p.title }
  );
  if (!proceed) return;
  const { error } = await sb.rpc('delete_mosaic_project', { p_project_id: p.id });
  if (error) { console.error('delete campaign error:', error); toast(tr('adminCouldNotDeleteCampaign')); return; }
  toast(tr('adminCampaignDeleted'));
  loadAdminCampaigns();
  // The freed pieces are back in the pool — place them right away, the same
  // trigger every other pool-changing event has — then refresh what changed.
  placePooledPieces(false).then(() => { loadAdminCampaigns(); loadAdminPool(); loadAdminUsage(); });
}

// ---------- campaigns: share image (create / recreate) ----------
// Campaigns made before preview_image_url existed have no share card (their
// links fall back to the site logo), and cards made earlier keep the grey
// contrast of that time — so the button creates or recreates it. This
// renders the same grey card the create / reshape paths make (common.js
// uploadPreviewImage, at the current previewContrast option) from the
// campaign's cells and records it — guarded on the card the row had when
// the list was drawn, so one that appeared or changed meanwhile is never
// overwritten. The previous file stays in Storage (nothing deletes uploads).
async function createAdminPreviewImage(p, btn) {
  btn.disabled = true;
  toast(tr('adminPreviewImageWorking'));
  try {
    const { cells, error } = await loadProjectCells(p);
    if (error) throw error;
    if (!cells.length) throw new Error('campaign has no cells');
    const url = await uploadPreviewImage(cells, p.width, p.height);
    if (!url) throw new Error('share image upload failed');
    let q = sb.from('mosaic_projects').update({ preview_image_url: url }).eq('id', p.id);
    q = p.preview_image_url ? q.eq('preview_image_url', p.preview_image_url) : q.is('preview_image_url', null);
    const { data: updated, error: updErr } = await q.select('id');
    if (updErr) throw updErr;
    if (!updated || !updated.length) throw new Error('campaign changed meanwhile — not updated');
    toast(tr('adminPreviewImageDone'));
    loadAdminCampaigns();
  } catch (e) {
    console.error('create share image error:', e);
    toast(tr('adminPreviewImageFailed'));
    btn.disabled = false;
  }
}

// ---------- campaigns: one-off grid image for older campaigns ----------
// Campaigns created before 2026-09-10 (or whose image upload failed) have
// no grid_image_url, so every view of them still pulls every mosaic_pixels
// row. This renders the same PNG the create/reshape paths make (common.js
// uploadGridImage), re-reads it through /img/ to prove it decodes back to
// exactly the same cells, and only then points the campaign at it. The
// update is guarded so a reshape that happened meanwhile (version_number
// changed, or an image appeared) is never overwritten with a stale picture.
async function createAdminGridImage(p, btn) {
  btn.disabled = true;
  toast(tr('adminGridImageWorking'));
  try {
    const { cells, error } = await loadProjectCells(p);
    if (error) throw error;
    if (!cells.length) throw new Error('campaign has no cells');
    const url = await uploadGridImage(cells, p.width, p.height);
    if (!url) throw new Error('grid image upload failed');
    const back = await loadGridImageCells({ ...p, grid_image_url: url });
    if (!back || back.length !== cells.length) throw new Error('grid image did not decode back to the same cells');
    const byKey = new Map(cells.map(c => [`${c.x},${c.y}`, c]));
    for (const c of back) {
      const o = byKey.get(`${c.x},${c.y}`);
      if (!o || o.target_r !== c.target_r || o.target_g !== c.target_g || o.target_b !== c.target_b) {
        throw new Error('grid image did not decode back to the same colors');
      }
    }
    let q = sb.from('mosaic_projects').update({ grid_image_url: url }).eq('id', p.id).is('grid_image_url', null);
    q = p.version_number == null ? q.is('version_number', null) : q.eq('version_number', p.version_number);
    const { data: updated, error: updErr } = await q.select('id');
    if (updErr) throw updErr;
    if (!updated || !updated.length) throw new Error('campaign changed meanwhile — not updated');
    toast(tr('adminGridImageDone'));
    loadAdminCampaigns();
  } catch (e) {
    console.error('create grid image error:', e);
    toast(tr('adminGridImageFailed'));
    btn.disabled = false;
  }
}

// ---------- campaigns: edit title / description ----------
// Size and reference image are NOT edited here — that's the reshape flow on
// the campaign page (js/project.js), which re-places the artwork. Title and
// description are plain columns an admin may update directly (RLS "Admins
// can update mosaic projects" in supabase_mosaic.sql).
let adminEditingCampaign = null;
function openAdminEditCampaign(p) {
  adminEditingCampaign = p;
  document.getElementById('aec-title').value = p.title || '';
  document.getElementById('aec-desc').value = p.description || '';
  document.getElementById('aec-error').textContent = '';
  document.getElementById('admin-edit-campaign-modal').classList.add('open');
  document.getElementById('aec-title').focus();
}
function closeAdminEditCampaign() {
  adminEditingCampaign = null;
  document.getElementById('admin-edit-campaign-modal').classList.remove('open');
}
async function saveAdminEditCampaign() {
  const p = adminEditingCampaign;
  if (!p) return;
  const title = document.getElementById('aec-title').value.trim();
  const description = document.getElementById('aec-desc').value.trim();
  const errorEl = document.getElementById('aec-error');
  if (!title) { errorEl.textContent = tr('titleRequired'); return; }
  errorEl.textContent = '';
  const btn = document.getElementById('aec-save');
  btn.disabled = true;
  const patch = { title, description: description || null };
  const { data: updated, error } = await sb.from('mosaic_projects').update(patch).eq('id', p.id).select('id');
  btn.disabled = false;
  if (error || !updated || !updated.length) {
    // No row back = RLS let nothing through (session expired, admin flag
    // gone) — report it rather than pretend the save worked.
    console.error('update campaign error:', error || 'no row updated');
    toast(tr('adminCouldNotUpdateCampaign'));
    return;
  }
  closeAdminEditCampaign();
  toast(tr('adminCampaignUpdated'));
  loadAdminCampaigns();
}
document.getElementById('aec-cancel').onclick = closeAdminEditCampaign;
document.getElementById('aec-save').onclick = saveAdminEditCampaign;
document.getElementById('admin-edit-campaign-modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeAdminEditCampaign(); });

// ---------- artwork thumbnails (thumb_url / micro_thumb rebuild) ----------
// Uploads make both derivatives in the browser (common.js
// makeArtworkDerivatives). Rows missing either — every piece uploaded while
// the thumb/ upload policy was missing (2026-08 … 2026-09-10), or one whose
// derivatives failed — are counted here and rebuilt on demand, one at a
// time: original read through /img/, thumb uploaded under the AUTHOR's
// thumb/ folder (the storage policy lets admins write there), row updated
// through the admin_set_submission_thumbs RPC (supabase_mosaic_micro_thumbs.sql).
let adminThumbRows = [];
async function loadAdminThumbs() {
  const btn = document.getElementById('adminThumbsRunBtn');
  if (!btn) return;
  // Artworks only — a piece copies its artwork's thumb_url and always has
  // its own micro_thumb; asked again without the filter while
  // supabase_mosaic_pieces.sql isn't applied.
  const q = artworksOnly => fetchAllRows(() => {
    const b = sb.from('mosaic_submissions').select('id,author_id,image_url,thumb_url,micro_thumb', { count: 'exact' }).or('thumb_url.is.null,micro_thumb.is.null');
    return artworksOnly ? b.is('parent_id', null) : b;
  });
  let { data, error } = await q(true);
  if (error && isSchemaMismatchError(error)) ({ data, error } = await q(false));
  if (error) {
    if (!isSchemaMismatchError(error)) console.error('load thumbnail status error:', error);
    adminShow('adminThumbsUnavailable', true); // SQL not applied yet
    btn.disabled = true;
    return;
  }
  adminThumbRows = data || [];
  document.getElementById('adminThumbsMissing').textContent = String(adminThumbRows.filter(r => !r.thumb_url).length);
  document.getElementById('adminMicroMissing').textContent = String(adminThumbRows.filter(r => !r.micro_thumb).length);
  btn.disabled = !adminThumbRows.length;
}
async function runAdminThumbs() {
  const btn = document.getElementById('adminThumbsRunBtn');
  btn.disabled = true;
  let done = 0, failed = 0;
  for (const row of adminThumbRows) {
    toast(tr('adminThumbsWorking', { done: done + failed, total: adminThumbRows.length }));
    try {
      // Same origin via /img/, so the canvas stays untainted for toDataURL.
      const img = await loadImageEl(cdnUrl(row.image_url));
      const d = await artworkDerivativesFromImage(img);
      let thumbUrl = row.thumb_url;
      if (!thumbUrl) {
        if (!d.thumbNeeded) thumbUrl = row.image_url; // already small: the original is its own thumbnail
        else if (d.thumbBlob) thumbUrl = await uploadThumbBlob(d.thumbBlob, row.author_id);
      }
      if (!thumbUrl) throw new Error('thumbnail could not be made or uploaded');
      const { error } = await sb.rpc('admin_set_submission_thumbs', { p_id: row.id, p_thumb_url: thumbUrl, p_micro_thumb: row.micro_thumb || d.micro });
      if (error) throw error;
      done++;
    } catch (e) {
      console.error(`thumbnail rebuild failed for #${row.id}:`, e);
      failed++;
    }
  }
  toast(failed ? tr('adminThumbsFailed', { done, failed }) : tr('adminThumbsDone', { n: done }));
  btn.disabled = false;
  loadAdminThumbs(); loadAdminUsage();
}
document.getElementById('adminThumbsRunBtn').onclick = runAdminThumbs;

// ---------- pixel boards (colour-by-number, supabase_pixel_game.sql) ----------
// A board is made in this browser from the artwork's thumbnail (same origin
// via /img/) and stored through set_pixel_board (js/pixel-board.js).
// Artworks without one are counted here; "Rebuild all" remakes every board
// with the current options, which restarts players' progress on them.
let adminPixelMissing = [];
let adminPixelAll = [];
async function loadAdminPixel() {
  const btn = document.getElementById('adminPixelRunBtn');
  const regenBtn = document.getElementById('adminPixelRegenBtn');
  if (!btn) return;
  const { data: boards, error } = await fetchAllRows(() => sb.from('pixel_boards').select('artwork_id', { count: 'exact' }), { orderBy: 'artwork_id' });
  if (error) {
    if (!isPixelSchemaMissing(error)) console.error('load pixel boards error:', error);
    adminShow('adminPixelUnavailable', true);
    btn.disabled = true; regenBtn.disabled = true;
    return;
  }
  const have = new Set((boards || []).map(b => b.artwork_id));
  // Artworks only, minus the opted-out ones; asked again without the
  // filters while their SQL is not applied.
  const q = withOptOut => fetchAllRows(() => {
    const b = sb.from('mosaic_submissions').select('id,author_id,thumb_url,image_url' + (withOptOut ? ',coloring_opt_out' : ''), { count: 'exact' }).is('parent_id', null);
    return withOptOut ? b.or('coloring_opt_out.is.null,coloring_opt_out.eq.false') : b;
  });
  let res = await q(true);
  if (res.error && isSchemaMismatchError(res.error)) res = await q(false);
  if (res.error) { console.error('load artworks for pixel boards error:', res.error); return; }
  adminPixelAll = (res.data || []).filter(r => r.thumb_url || r.image_url);
  adminPixelMissing = adminPixelAll.filter(r => !have.has(r.id));
  document.getElementById('adminPixelMissing').textContent = String(adminPixelMissing.length);
  document.getElementById('adminPixelDone').textContent = String(adminPixelAll.length - adminPixelMissing.length);
  btn.disabled = !adminPixelMissing.length;
  regenBtn.disabled = !adminPixelAll.length;
}
async function runAdminPixel(all) {
  if (all) {
    const ok = await confirmDialog(tr('adminPixelRegenConfirm'));
    if (!ok) return;
  }
  const rows = all ? adminPixelAll : adminPixelMissing;
  const btns = [document.getElementById('adminPixelRunBtn'), document.getElementById('adminPixelRegenBtn')];
  btns.forEach(b => { b.disabled = true; });
  const settings = await getSiteSettings();
  let done = 0, failed = 0, skipped = 0;
  for (const row of rows) {
    toast(tr('adminPixelWorking', { done: done + failed + skipped, total: rows.length }));
    try {
      const img = await loadImageEl(cdnUrl(row.thumb_url || row.image_url));
      const res = await makePixelBoardFor(row.id, img, settings);
      if (res.unsuitable) { skipped++; continue; }
      if (res.error) throw res.error;
      if (res.missing) throw new Error('supabase_pixel_game.sql not applied');
      done++;
    } catch (e) {
      console.error(`pixel board failed for #${row.id}:`, e);
      failed++;
    }
  }
  toast(failed ? tr('adminPixelFailed', { done, failed }) : tr('adminPixelDone', { n: done, skipped }));
  loadAdminPixel();
}
document.getElementById('adminPixelRunBtn').onclick = () => runAdminPixel(false);
document.getElementById('adminPixelRegenBtn').onclick = () => runAdminPixel(true);

// ---------- artwork pieces (supabase_mosaic_pieces.sql) ----------
// Artworks are cut into pieceGrid × pieceGrid pieces in the browser when
// uploaded (common.js makeArtworkPieces). Artworks from before that — or
// whose cut failed — are counted here and cut on demand; "recut all" redoes
// every artwork at the current pieceGrid (placed pieces are released and
// matched again). Same shape as the thumbnail rebuild above: original read
// through /img/, one artwork at a time, a matching pass at the end.
let adminPieceRows = [];
async function loadAdminPieces() {
  const btn = document.getElementById('adminPiecesRunBtn');
  const regenBtn = document.getElementById('adminPiecesRegenBtn');
  if (!btn || !regenBtn) return;
  const { data, error } = await fetchAllRows(() => sb.from('mosaic_submissions')
    .select('id,image_url,piece_n', { count: 'exact' }).is('parent_id', null));
  if (error) {
    if (!isSchemaMismatchError(error)) console.error('load pieces status error:', error);
    adminShow('adminPiecesUnavailable', true); // SQL not applied yet
    btn.disabled = true; regenBtn.disabled = true;
    return;
  }
  adminPieceRows = data || [];
  const missing = adminPieceRows.filter(r => !r.piece_n).length;
  document.getElementById('adminPiecesMissing').textContent = String(missing);
  document.getElementById('adminPiecesDoneCount').textContent = String(adminPieceRows.length - missing);
  btn.disabled = !missing;
  regenBtn.disabled = !adminPieceRows.length;
}
async function runAdminPieces(all) {
  if (all) {
    const proceed = await confirmDialog(tr('adminPiecesRegenConfirm'), { title: tr('adminPiecesRegenTitle'), okLabel: tr('adminPiecesRegenLabel') });
    if (!proceed) return;
  }
  const rows = all ? adminPieceRows : adminPieceRows.filter(r => !r.piece_n);
  const btns = [document.getElementById('adminPiecesRunBtn'), document.getElementById('adminPiecesRegenBtn')];
  btns.forEach(b => { b.disabled = true; });
  let done = 0, failed = 0;
  for (const row of rows) {
    toast(tr('adminPiecesWorking', { done: done + failed, total: rows.length }));
    try {
      // Same origin via /img/, so the canvas stays readable.
      const img = await loadImageEl(cdnUrl(row.image_url));
      const res = typeof makeArtworkPieces === 'function' ? await makeArtworkPieces(row.id, img) : { missing: true };
      if (res.missing || res.error) throw res.error || new Error('set_submission_pieces unavailable');
      done++;
    } catch (e) {
      console.error(`piece cut failed for #${row.id}:`, e);
      failed++;
    }
  }
  toast(failed ? tr('adminPiecesFailed', { done, failed }) : tr('adminPiecesDone', { n: done }));
  // The new pieces wait in the pool — place them now.
  if (done) await placePooledPieces(false);
  loadAdminPieces(); loadAdminPool(); loadAdminUsage(); loadAdminCampaigns();
}
document.getElementById('adminPiecesRunBtn').onclick = () => runAdminPieces(false);
document.getElementById('adminPiecesRegenBtn').onclick = () => runAdminPieces(true);

// "Apply colour match to all" (Site options): a changed pieceMatchDistance
// only reaches new uploads on its own — placed pieces beyond it are released
// by the 6-hourly cleanup, and waiting pieces are re-tried only when their
// campaign gains open cells. This does all of it now: the cleanup without
// its wait (release_poor_matches with a zero interval), every waiting
// piece's last-try mark cleared (admin_reset_piece_tries —
// supabase_mosaic_pieces_retry.sql), then matching passes (1,500 pieces
// each) until the pool has been gone through.
async function applyPieceMatchToAll() {
  const btn = document.getElementById('adminPieceApplyBtn');
  const proceed = await confirmDialog(tr('adminPieceApplyConfirm'), { title: tr('adminPieceApplyTitle'), okLabel: tr('adminPieceApplyLabel') });
  if (!proceed) return;
  btn.disabled = true;
  toast(tr('adminPieceApplyWorking'));
  try {
    const { data: waiting, error: resetErr } = await sb.rpc('admin_reset_piece_tries');
    if (resetErr) throw resetErr;
    const { data: released, error: relErr } = await sb.rpc('release_poor_matches', { p_min_interval: '0 seconds' });
    if (relErr) throw relErr;
    // Released pieces join the waiting ones; each pass takes up to 1,500.
    const passes = Math.ceil(((Number(waiting) || 0) + (Number(released) || 0)) / 1500) + 1;
    let placed = 0;
    for (let i = 0; i < passes; i++) {
      const assignments = await runPoolMatching();
      placed += assignments.length;
    }
    toast(tr('adminPieceApplyDone', { released: Number(released) || 0, retried: Number(waiting) || 0, placed }));
  } catch (e) {
    console.error('apply piece match error:', e);
    // A missing function is either this feature's own RPC (its SQL file not
    // applied) or one the cleanup relies on — claim_rematch_slot /
    // unmatch_submissions / mosaic_meta from supabase_mosaic_rematch.sql,
    // which turned out never applied on 2026-09-10 — so name the file.
    const missing = !!e && (e.code === 'PGRST202' || e.code === '42883');
    const msg = String((e && (e.message || e.details)) || '');
    if (missing && /claim_rematch_slot|unmatch_submissions|mosaic_meta/.test(msg)) toast(tr('adminPieceApplyMissingRematch'));
    else if (missing) toast(tr('adminPieceApplyMissing'));
    else toast(tr('adminPieceApplyFailed'));
  } finally {
    btn.disabled = false;
    loadAdminPool(); loadAdminUsage(); loadAdminCampaigns(); loadAdminPieces();
  }
}
document.getElementById('adminPieceApplyBtn').onclick = applyPieceMatchToAll;

// ---------- pool: pieces waiting for a campaign ----------
// Pieces with no campaign — fresh uploads nothing matched yet, or pieces a
// campaign deletion sent back — wait in the pool until the next matching
// pass, and passes only run on events (upload, campaign creation, reshape,
// piece removal, campaign deletion). This section lists what is waiting and
// lets an admin run a pass right now; pieces whose color is too far from
// every open cell (POOR_MATCH_DISTANCE) simply stay listed.
async function loadAdminPool() {
  const list = document.getElementById('adminPoolList');
  if (!list) return;
  // Whole artworks still waiting (none once every artwork is cut), plus
  // how many PIECES wait — those are what a matching pass places now.
  const q = withPieces => {
    let b = sb.from('mosaic_submissions').select('id,art_title,author_name,thumb_url,image_url,created_at', { count: 'exact' }).is('project_id', null);
    if (withPieces) b = b.is('parent_id', null).is('piece_n', null);
    return b.order('created_at', { ascending: true }).limit(50);
  };
  let { data, error, count } = await q(true);
  if (error && isSchemaMismatchError(error)) ({ data, error, count } = await q(false));
  if (error) { console.error('load pool error:', error); toast(tr('adminLoadError')); return; }
  const piecesEl = document.getElementById('adminPoolPieces');
  if (piecesEl) {
    const { count: waiting, error: pErr } = await sb.from('mosaic_submissions').select('id', { count: 'exact', head: true }).not('parent_id', 'is', null).is('project_id', null);
    piecesEl.textContent = pErr ? '—' : String(waiting ?? 0);
  }
  document.getElementById('adminPoolCount').textContent = String(count ?? (data || []).length);
  list.innerHTML = '';
  adminShow('adminPoolEmpty', !(data && data.length));
  for (const s of data || []) {
    const row = document.createElement('div'); row.className = 'admin-row';
    const target = document.createElement('div'); target.className = 'admin-target';
    const img = document.createElement('img'); img.className = 'admin-thumb'; img.alt = ''; img.loading = 'lazy';
    img.src = cdnUrl(s.thumb_url || s.image_url);
    const a = document.createElement('a'); a.className = 'admin-target-label'; a.href = artworkUrl(s.id);
    a.textContent = s.art_title || tr('untitledArtwork');
    target.append(img, a);
    const meta = document.createElement('div'); meta.className = 'admin-meta';
    const sub = document.createElement('div'); sub.className = 'admin-sub';
    sub.textContent = `${s.author_name || tr('anonymous')} · ${adminDate(s.created_at)}`;
    meta.appendChild(sub);
    row.append(target, meta);
    list.appendChild(row);
  }
}
// Runs a matching pass (js/matching.js — server RPC, client fallback) and
// reports how many pooled pieces landed in a campaign.
async function placePooledPieces(sayWhenNone) {
  try {
    const assignments = await runPoolMatching();
    if (assignments.length) toast(tr('adminPoolPlaced', { n: assignments.length }));
    else if (sayWhenNone) toast(tr('adminPoolNonePlaced'));
    return assignments.length;
  } catch (err) {
    console.error('admin pool matching error:', err);
    toast(tr('adminPoolFailed'));
    return 0;
  }
}
async function runAdminPoolMatching() {
  const btn = document.getElementById('adminPoolRunBtn');
  btn.disabled = true;
  toast(tr('adminPoolRunning'));
  await placePooledPieces(true);
  btn.disabled = false;
  loadAdminPool(); loadAdminCampaigns(); loadAdminUsage();
}
document.getElementById('adminPoolRunBtn').onclick = runAdminPoolMatching;

// ---------- admins ----------
// ---------- new members ----------
// profiles is publicly readable (the artists page lists it), so this needs
// no RPC — just the rows created inside the window. Accounts with no
// username are included on purpose: someone who signed in and never
// finished onboarding is exactly the kind of row an admin wants to see,
// and the artists page hides them.
// One member, one line: avatar, name, joined date. Both member lists use
// it so the two read as the same thing — and the dates line up in a column
// down the list instead of starting wherever each name happens to end.
function adminMemberRow(p, opts) {
  const o = opts || {};
  const name = p.username || p.name || tr('adminNoUsername');
  const row = document.createElement('div');
  row.className = 'admin-row admin-member';
  row.appendChild(miniAvatarEl(name, p.avatar_url, p.id));

  const link = document.createElement('a');
  link.className = 'admin-target-label';
  link.href = profileUrl(p.username || p.id);
  link.textContent = name;
  if (o.badge) {
    const badge = document.createElement('span');
    badge.className = 'admin-badge';
    badge.textContent = o.badge;
    link.appendChild(document.createTextNode(' '));
    link.appendChild(badge);
  }
  row.appendChild(link);

  if (p.created_at) {
    const when = document.createElement('span');
    when.className = 'admin-member-date';
    when.textContent = o.withTime ? adminDateTime(p.created_at) : adminDate(p.created_at);
    row.appendChild(when);
  }
  return row;
}
function adminDateTime(iso) {
  return new Date(iso).toLocaleString(CURRENT_LANG === 'ko' ? 'ko-KR' : 'en-US',
    { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
async function loadAdminNewMembers() {
  const list = document.getElementById('adminNewMembers');
  const empty = document.getElementById('adminNewMembersEmpty');
  const countEl = document.getElementById('adminNewMembersCount');
  if (!list) return;
  const settings = await getSiteSettings();
  const days = Math.max(1, Math.min(30, Number(settings.adminNewMemberDays) || 5));
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const { data, error } = await sb.from('profiles')
    .select('id,username,name,avatar_url,created_at,is_admin')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) { console.error('load new members error:', error); return; }
  const rows = data || [];
  list.innerHTML = '';
  countEl.textContent = tr('adminNewMembersCount', { n: adminNum(rows.length), days });
  for (const p of rows) {
    // Time as well as date here: five days is a short window and "어제 밤"
    // is the useful part of a brand-new sign-up.
    list.appendChild(adminMemberRow(p, { withTime: true, badge: p.is_admin ? tr('adminRoleAdmin') : '' }));
  }
  empty.style.display = rows.length ? 'none' : '';
}
async function loadAdminAdmins() {
  const { data, error } = await sb.from('profiles').select('id,username,name,avatar_url,created_at').eq('is_admin', true).order('username');
  if (error) { console.error('load admins error:', error); return; }
  const list = document.getElementById('adminAdmins');
  list.innerHTML = '';
  for (const p of data || []) {
    list.appendChild(adminMemberRow(p, { badge: p.id === me.id ? tr('adminYou') : '' }));
  }
}

// ---------- usage (DB / Storage) ----------
// admin_usage_stats() (supabase_mosaic_server_matching.sql §5) reads the
// database size and sums storage.objects. Monthly egress is a platform
// metric that only the Supabase dashboard has — the page says so instead of
// pretending. Section stays hidden until that SQL has been applied.
// Usage as a share of the plan limit (dbLimitGb / storageLimitGb, site
// options). Below 0.1% a single decimal would read "0.0%", so go finer —
// 0.35 GB of 100 GB really is 0.35%, not nothing.
function adminSharePct(used, limitBytes) {
  if (used == null || !limitBytes) return null;
  const pct = (used / limitBytes) * 100;
  return pct > 0 && pct < 0.1 ? pct.toFixed(2) : pct.toFixed(1);
}
function adminBytes(n) {
  if (n == null) return '—';
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.round(n / 1024)} KB`;
}
async function loadAdminUsage() {
  const section = document.getElementById('adminUsageSection');
  if (!section) return;
  const { data, error } = await sb.rpc('admin_usage_stats');
  if (error) {
    if (error.code !== 'PGRST202' && error.code !== '42883') console.error('admin_usage_stats error:', error);
    section.style.display = 'none';
    return;
  }
  section.style.display = '';
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('adminDbSize', adminBytes(data.db_bytes));
  set('adminStorageSize', adminBytes(data.storage_bytes));
  set('adminStorageFiles', String(data.storage_files ?? '—'));
  set('adminCountSubmissions', `${data.submissions ?? '—'} (${data.pooled ?? 0})`);
  set('adminCountPixels', String(data.pixels ?? '—'));
  set('adminCountProjects', String(data.projects ?? '—'));
  set('adminCountProfiles', String(data.profiles ?? '—'));

  // Plan limits come from the site options, so an upgrade is a settings
  // change rather than a deploy. getSiteSettings() never rejects.
  const settings = await getSiteSettings();
  const share = (id, used, limitGb) => {
    const el = document.getElementById(id);
    if (!el) return;
    const limitBytes = Number(limitGb) * 1024 ** 3;
    const pct = adminSharePct(used, limitBytes);
    el.textContent = pct == null ? '—' : tr('adminUsageShare', { pct, limit: adminBytes(limitBytes) });
    el.classList.toggle('over', pct != null && Number(pct) >= 80);
  };
  share('adminDbShare', data.db_bytes, settings.dbLimitGb);
  share('adminStorageShare', data.storage_bytes, settings.storageLimitGb);
}

// ---------- visitor statistics (visit_days) ----------
// admin_visit_stats(p_days) (supabase_visit_stats.sql) returns one row per
// day for the last N days — guests, members, new artworks, new members —
// oldest first, with empty days already filled in as 0. Until that SQL has
// been applied (PGRST202 / 42883: function missing) the section shows a
// notice instead of its tiles and chart.
const ADMIN_VISIT_DAYS = 10;
const adminNum = n => Number(n || 0).toLocaleString(CURRENT_LANG === 'ko' ? 'ko-KR' : 'en-US');
async function loadAdminVisits() {
  const section = document.getElementById('adminVisitsSection');
  if (!section) return;
  const { data, error } = await sb.rpc('admin_visit_stats', { p_days: ADMIN_VISIT_DAYS });
  if (error) {
    if (error.code !== 'PGRST202' && error.code !== '42883') console.error('admin_visit_stats error:', error);
    adminShow('adminVisitsUnavailable', true);
    adminShow('adminVisitsBody', false);
    return;
  }
  const rows = Array.isArray(data) ? data : [];
  adminShow('adminVisitsUnavailable', false);
  adminShow('adminVisitsBody', true);
  const sum = key => rows.reduce((a, r) => a + Number(r[key] || 0), 0);
  const today = rows[rows.length - 1] || {};
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('adminVisitsToday', adminNum(Number(today.guests || 0) + Number(today.members || 0)));
  set('adminVisitsTodayMembers', adminNum(today.members));
  set('adminVisitsTodayGuests', adminNum(today.guests));
  set('adminVisitsTotal', adminNum(sum('guests') + sum('members')));
  set('adminVisitsTotalMembers', adminNum(sum('members')));
  set('adminVisitsTotalGuests', adminNum(sum('guests')));
  set('adminVisitsNewArtworks', adminNum(today.new_artworks));
  set('adminVisitsNewArtworksAll', adminNum(sum('new_artworks')));
  set('adminVisitsNewMembers', adminNum(today.new_members));
  set('adminVisitsNewMembersAll', adminNum(sum('new_members')));
  const chart = document.getElementById('adminVisitsChart');
  if (chart) chart.innerHTML = adminVisitsChartSvg(rows);
}
// Stacked bars — guests below, members on top — with the day's total above
// each bar and the date under it, as one inline <svg>. Ten bars need no
// chart library (this page does not load d3). The width is fluid through
// the viewBox; colours live in admin.css (.admin-bar-*) and the static
// legend in the HTML reuses those classes. Dates arrive as YYYY-MM-DD
// strings and are split by hand — new Date("YYYY-MM-DD") would shift them
// to UTC.
function adminVisitsChartSvg(rows) {
  const W = 640, H = 210, top = 24, bottom = 26, left = 8, right = 8;
  const n = Math.max(rows.length, 1);
  const slot = (W - left - right) / n;
  const barW = Math.min(36, slot * 0.6);
  const area = H - top - bottom;
  const base = H - bottom;
  const max = Math.max(1, ...rows.map(r => Number(r.guests || 0) + Number(r.members || 0)));
  const label = iso => { const p = String(iso).split('-'); return p.length === 3 ? `${Number(p[1])}/${Number(p[2])}` : String(iso); };
  const parts = [`<line class="admin-chart-axis" x1="${left}" y1="${base + 0.5}" x2="${W - right}" y2="${base + 0.5}"/>`];
  rows.forEach((r, i) => {
    const g = Number(r.guests || 0), m = Number(r.members || 0), total = g + m;
    const x = (left + slot * i + (slot - barW) / 2).toFixed(1);
    const cx = (left + slot * i + slot / 2).toFixed(1);
    const gh = area * g / max, mh = area * m / max;
    const tip = escapeHtml(tr('adminVisitsTip', { date: r.day, total: adminNum(total), members: adminNum(m), guests: adminNum(g) }));
    parts.push(`<g><title>${tip}</title>`
      + `<rect class="admin-bar-guests" x="${x}" y="${(base - gh).toFixed(1)}" width="${barW.toFixed(1)}" height="${gh.toFixed(1)}"/>`
      + `<rect class="admin-bar-members" x="${x}" y="${(base - gh - mh).toFixed(1)}" width="${barW.toFixed(1)}" height="${mh.toFixed(1)}"/>`
      + `<text class="admin-chart-total" x="${cx}" y="${(base - gh - mh - 6).toFixed(1)}" text-anchor="middle">${adminNum(total)}</text>`
      + `<text class="admin-chart-day" x="${cx}" y="${H - 8}" text-anchor="middle">${escapeHtml(label(r.day))}</text></g>`);
  });
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeHtml(tr('adminVisitsChartLabel', { n: rows.length }))}">${parts.join('')}</svg>`;
}

// ---------- site options (site_settings) ----------
// The checkboxes are static HTML (en/ko admin.html) tagged
// data-setting="<key>"; this binds each one to the site_settings row
// (supabase_site_settings.sql; pages read it via common.js
// getSiteSettings). A change saves just that key through the
// admin_set_site_settings RPC and writes the result into this tab's cached
// copy, so the admin sees the effect on the next page they open.
async function loadAdminSettings() {
  const inputs = document.querySelectorAll('#adminSettings input[data-setting]');
  if (!inputs.length) return;
  // Read the row directly (not getSiteSettings): this page must show what
  // is stored, not a cached copy.
  const { data, error } = await sb.from('site_settings').select('settings').eq('id', true).maybeSingle();
  if (error) {
    if (error.code !== 'PGRST205' && error.code !== '42P01') console.error('load site_settings error:', error);
    adminShow('adminSettingsUnavailable', true); // inputs stay disabled
    return;
  }
  const settings = { ...SITE_SETTING_DEFAULTS, ...((data && data.settings) || {}) };
  inputs.forEach(input => {
    const key = input.dataset.setting;
    adminSettingApply(input, adminSettingIsNumber(input) ? adminSettingNumber(settings[key], key)
      : adminSettingIsColor(input) ? adminSettingColor(settings[key], key)
      : adminSettingIsText(input) ? String(settings[key] ?? '')
      : !!settings[key]);
    input.disabled = false;
    // Dragging a slider only updates its readout and preview; the save
    // happens on change (release), once.
    input.oninput = () => { if (adminSettingIsNumber(input) || adminSettingIsColor(input)) syncAdminSettingOutput(input); };
    input.onchange = () => saveAdminSetting(input);
  });
}
// Number options (type=range / number, e.g. previewContrast) and colour
// options (type=color, e.g. previewTint) are bound like the checkboxes:
// numbers clamped to the input's min/max, colours as #rrggbb, both shown in
// the <output data-setting-output="key"> beside them and remembered in
// data-saved so a failed save can put the stored value back.
function adminSettingIsNumber(input) { return input.type === 'range' || input.type === 'number'; }
function adminSettingIsColor(input) { return input.type === 'color'; }
// Free-text options (the VAPID public key, the push Edge Function URL):
// stored as-is, trimmed, and saved when the field loses focus.
function adminSettingIsText(input) { return input.type === 'text' || input.type === 'url'; }
function adminSettingColor(v, key) {
  const raw = String(v || '').trim();
  return /^#[0-9a-f]{6}$/i.test(raw) ? raw.toUpperCase() : String(SITE_SETTING_DEFAULTS[key]).toUpperCase();
}
function adminSettingNumber(v, key) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : (Number(SITE_SETTING_DEFAULTS[key]) || 0);
}
function adminSettingValue(input) {
  if (adminSettingIsText(input)) return input.value.trim();
  if (adminSettingIsColor(input)) return adminSettingColor(input.value, input.dataset.setting);
  if (!adminSettingIsNumber(input)) return input.checked;
  const min = Number(input.min || 0), max = Number(input.max || 100);
  return Math.min(max, Math.max(min, adminSettingNumber(input.value, input.dataset.setting)));
}
function adminSettingApply(input, value) {
  if (adminSettingIsNumber(input) || adminSettingIsText(input)) input.value = String(value ?? '');
  else if (adminSettingIsColor(input)) input.value = adminSettingColor(value, input.dataset.setting).toLowerCase(); // <input type=color> wants lowercase
  else input.checked = !!value;
  input.dataset.saved = JSON.stringify(value);
  syncAdminSettingOutput(input);
}
function syncAdminSettingOutput(input) {
  if (!adminSettingIsNumber(input) && !adminSettingIsColor(input)) return; // text options have no readout
  const key = input.dataset.setting;
  const out = document.querySelector(`[data-setting-output="${key}"]`);
  if (out) out.textContent = adminSettingIsColor(input) ? String(input.value).toUpperCase() : String(input.value);
  if (key === 'previewContrast' || key === 'previewBrightness' || key === 'previewTint') paintAdminGrayPreview().catch(e => console.error('grey preview error:', e));
}
async function saveAdminSetting(input) {
  const key = input.dataset.setting;
  const value = adminSettingValue(input);
  input.disabled = true;
  const { data, error } = await sb.rpc('admin_set_site_settings', { p_patch: { [key]: value } });
  input.disabled = false;
  if (error) {
    console.error('admin_set_site_settings error:', error);
    // Back to what is actually stored.
    adminSettingApply(input, input.dataset.saved ? JSON.parse(input.dataset.saved) : SITE_SETTING_DEFAULTS[key]);
    toast(tr('adminSettingSaveFailed'));
    return;
  }
  adminSettingApply(input, value);
  setSiteSettingsCache(data);
  toast(tr('adminSettingSaved'));
}

// ---------- site options: open-cell grey preview ----------
// The contrast / brightness sliders and the tint colour repaint a small
// canvas with the newest live campaign that has a grid image (one small PNG
// through /img/, cached by loadProjectCells) so the admin sees the effect
// before saving. The preview reads all three inputs' current values, saved
// or not. When no campaign has a grid image yet the canvas is hidden and a
// note says so.
let adminContrastCellsPromise = null;
function getAdminContrastCells() {
  if (!adminContrastCellsPromise) {
    adminContrastCellsPromise = (async () => {
      const { data, error } = await sb.from('mosaic_projects')
        .select('id,width,height,version_number,grid_image_url')
        .eq('is_archived', false).not('grid_image_url', 'is', null)
        .order('created_at', { ascending: false }).limit(1);
      if (error) { console.error('load contrast preview campaign error:', error); return null; }
      const p = data && data[0];
      if (!p) return null;
      const { cells } = await loadProjectCells(p);
      return cells && cells.length ? { cells, width: p.width, height: p.height } : null;
    })();
  }
  return adminContrastCellsPromise;
}
function adminGrayPreviewSettings() {
  const read = key => {
    const el = document.querySelector(`#adminSettings input[data-setting="${key}"]`);
    return el ? Number(el.value) : SITE_SETTING_DEFAULTS[key];
  };
  const tint = document.querySelector('#adminSettings input[data-setting="previewTint"]');
  return { previewContrast: read('previewContrast'), previewBrightness: read('previewBrightness'), previewTint: tint ? tint.value : SITE_SETTING_DEFAULTS.previewTint };
}
async function paintAdminGrayPreview() {
  const canvas = document.getElementById('adminContrastPreview');
  // A stale common.js without openCellPainter (cache transition, CLAUDE.md
  // §12) just leaves the preview hidden; the options themselves still save.
  if (!canvas || typeof openCellPainter !== 'function') return;
  const grid = await getAdminContrastCells();
  adminShow('adminContrastPreviewNone', !grid);
  canvas.style.display = grid ? '' : 'none';
  if (!grid) return;
  const cell = 4;
  canvas.width = grid.width * cell; canvas.height = grid.height * cell;
  canvas.style.aspectRatio = `${grid.width} / ${grid.height}`;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const paint = openCellPainter(grid.cells, adminGrayPreviewSettings());
  for (const c of grid.cells) {
    ctx.fillStyle = paint(c.target_r, c.target_g, c.target_b);
    ctx.fillRect(c.x * cell, c.y * cell, cell, cell);
  }
}

// ---------- action log (supabase_admin_moderation.sql) ----------
// Every destructive thing this page does writes one entry. The RPC stamps
// the actor from auth.uid(), so nothing here can be attributed to someone
// else. If the file isn't applied yet, the first call says so and the rest
// stay quiet — a missing log must never stop moderation.
let adminLogAvailable = true;
async function adminLogAction(action, targetType, targetId, detail) {
  if (!adminLogAvailable) return;
  const { error } = await sb.rpc('admin_log_action', {
    p_action: action, p_target_type: targetType, p_target_id: targetId == null ? null : String(targetId), p_detail: detail || {},
  });
  if (error) {
    if (isSchemaMismatchError(error)) adminLogAvailable = false;
    console.error('admin_log_action error:', error);
  }
}

const ADMIN_LOG_ACTIONS = ['artwork_delete', 'comment_delete', 'upload_block', 'upload_unblock', 'broadcast'];

async function loadAdminLog() {
  const list = document.getElementById('adminLog');
  const { data, error } = await sb.from('admin_audit_log')
    .select('id,actor_name,action,target_type,target_id,detail,created_at')
    .order('created_at', { ascending: false }).limit(200);
  if (error) {
    if (error.code === 'PGRST205' || error.code === '42P01' || error.code === '42501') { adminShow('adminLogUnavailable', true); return; }
    console.error('load audit log error:', error); toast(tr('adminLoadError')); return;
  }
  const rows = data || [];
  list.innerHTML = '';
  adminShow('adminLogEmpty', rows.length === 0);
  for (const r of rows) {
    const row = document.createElement('div');
    row.className = 'admin-row';
    const meta = document.createElement('div'); meta.className = 'admin-meta';
    const head = document.createElement('div');
    head.className = 'admin-log-action';
    // tr() echoes an unknown key back, so only translate the actions this
    // page writes and show anything else verbatim.
    head.textContent = ADMIN_LOG_ACTIONS.includes(r.action) ? tr(`adminLogAction_${r.action}`) : r.action;
    const sub = document.createElement('div'); sub.className = 'admin-sub';
    sub.textContent = `${r.actor_name || tr('adminTargetMissing')} · ${adminDate(r.created_at)}`;
    meta.append(head, sub);
    const detail = r.detail && Object.keys(r.detail).length ? r.detail : null;
    if (detail) {
      const d = document.createElement('div'); d.className = 'admin-log-detail';
      d.textContent = Object.entries(detail).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}: ${v}`).join(' · ');
      if (d.textContent) meta.appendChild(d);
    }
    row.appendChild(meta);
    list.appendChild(row);
  }
}

// ---------- shared multi-select delete plumbing ----------
// CLAUDE.md §13 forbids a bulk artwork-deletion RPC, and there isn't one:
// rows go one at a time through the existing per-row delete policy, capped
// here so a mis-click can never take out more than a screenful. The cap is
// a client guard on a deliberate action, not a security boundary.
const ADMIN_BULK_MAX = 20;

// A blocked delete is NOT an error in PostgREST — the policy simply matches
// no rows and it returns success. Asking for the deleted ids back is the
// only way to tell "removed" from "refused".
async function adminDeleteRow(table, id) {
  const { data, error } = await sb.from(table).delete().eq('id', id).select('id');
  if (error) return { ok: false, refused: false, error };
  return { ok: !!(data && data.length), refused: !(data && data.length), error: null };
}

// Storage paths behind one artwork: the original, plus the 480px thumbnail
// when it is a file of its own (an original already ≤480px is reused as the
// thumbnail, same URL). The micro thumbnail is a data URI — no file.
function adminStoragePaths(sub) {
  const paths = new Set();
  for (const url of [sub.image_url, sub.thumb_url]) {
    if (!url || !String(url).startsWith(SUPABASE_STORAGE_PREFIX)) continue;
    const rest = String(url).slice(SUPABASE_STORAGE_PREFIX.length).split('?')[0];
    if (rest.startsWith('artwork/')) paths.add(decodeURIComponent(rest.slice('artwork/'.length)));
  }
  return [...paths];
}

// ---------- artworks tab: browse + multi-select delete ----------
const ADMIN_ART_PAGE = 60;
let adminArtOffset = 0, adminArtDone = false, adminArtRun = 0, adminArtHasPieces = true;
const adminArtSelected = new Map(); // id → row (kept so a delete still has its URLs after a filter change)

function adminArtFilters() {
  const days = Number(document.getElementById('adminArtRange').value) || 0;
  return { days, author: document.getElementById('adminArtAuthor').value.trim() };
}

async function resetAdminArtworks() {
  adminArtOffset = 0; adminArtDone = false;
  adminArtSelected.clear();
  document.getElementById('adminArtGrid').innerHTML = '';
  document.getElementById('adminArtSelectAll').checked = false;
  syncAdminArtBar();
  await loadMoreAdminArtworks();
}

async function loadMoreAdminArtworks() {
  const run = ++adminArtRun;
  const { days, author } = adminArtFilters();
  const btn = document.getElementById('adminArtMoreBtn');
  btn.disabled = true;

  const build = withPieces => {
    let q = sb.from('mosaic_submissions')
      .select('id,art_title,author_id,author_name,thumb_url,image_url,created_at')
      .order('created_at', { ascending: false })
      .range(adminArtOffset, adminArtOffset + ADMIN_ART_PAGE - 1);
    if (withPieces) q = q.is('parent_id', null); // pieces are rows too — never list them
    if (days) q = q.gte('created_at', new Date(Date.now() - days * 86400000).toISOString());
    if (author) q = q.ilike('author_name', `%${author}%`);
    return q;
  };
  let { data, error } = await build(adminArtHasPieces);
  if (error && adminArtHasPieces && isSchemaMismatchError(error)) {
    adminArtHasPieces = false;
    ({ data, error } = await build(false));
  }
  btn.disabled = false;
  if (run !== adminArtRun) return; // a newer filter already took over
  if (error) { console.error('load admin artworks error:', error); toast(tr('adminLoadError')); return; }

  const rows = data || [];
  const grid = document.getElementById('adminArtGrid');
  for (const sub of rows) grid.appendChild(adminArtCardEl(sub));
  adminArtOffset += rows.length;
  adminArtDone = rows.length < ADMIN_ART_PAGE;
  adminShow('adminArtEmpty', adminArtOffset === 0);
  btn.style.display = adminArtDone ? 'none' : '';
  syncAdminArtBar();
}

function adminArtCardEl(sub) {
  const card = document.createElement('div');
  card.className = 'admin-art';
  card.dataset.id = String(sub.id);

  const check = document.createElement('input');
  check.type = 'checkbox'; check.className = 'admin-art-check';
  check.checked = adminArtSelected.has(sub.id);
  check.setAttribute('aria-label', sub.art_title || tr('adminNoTitle'));
  check.onchange = () => setAdminArtSelected(sub, check.checked, card);

  const img = document.createElement('img');
  img.className = 'admin-art-img'; img.loading = 'lazy';
  img.src = cdnUrl(sub.thumb_url || sub.image_url); img.alt = '';

  const open = document.createElement('a');
  open.className = 'admin-art-open'; open.href = artworkUrl(sub.id);
  open.target = '_blank'; open.rel = 'noopener';
  open.textContent = '↗'; open.title = tr('adminOpenArtwork');

  const info = document.createElement('div'); info.className = 'admin-art-info';
  const title = document.createElement('div');
  title.className = 'admin-art-title'; title.textContent = sub.art_title || tr('adminNoTitle');
  const by = document.createElement('button');
  by.type = 'button'; by.className = 'admin-art-by';
  by.textContent = sub.author_name || tr('anonymous');
  by.title = tr('adminFilterByArtist');
  by.onclick = () => {
    document.getElementById('adminArtAuthor').value = sub.author_name || '';
    resetAdminArtworks();
  };
  const date = document.createElement('div');
  date.className = 'admin-art-date'; date.textContent = adminDate(sub.created_at);
  info.append(title, by, date);

  card.append(check, img, open, info);
  card.classList.toggle('selected', check.checked);
  // The tile itself toggles selection; its link and artist button keep theirs.
  card.onclick = e => {
    if (e.target === check || e.target.closest('a, button')) return;
    check.checked = !check.checked;
    setAdminArtSelected(sub, check.checked, card);
  };
  return card;
}

function setAdminArtSelected(sub, on, card) {
  if (on) adminArtSelected.set(sub.id, sub); else adminArtSelected.delete(sub.id);
  card.classList.toggle('selected', on);
  syncAdminArtBar();
}

function syncAdminArtBar() {
  const n = adminArtSelected.size;
  const btn = document.getElementById('adminArtDeleteBtn');
  btn.disabled = n === 0;
  btn.textContent = n ? tr('adminDeleteSelectedN', { n }) : tr('adminDeleteSelected');
  btn.classList.toggle('over-limit', n > ADMIN_BULK_MAX);
  document.getElementById('adminArtCount').textContent =
    tr('adminShownSelected', { shown: adminArtOffset, selected: n });
}

async function deleteSelectedArtworks() {
  const rows = [...adminArtSelected.values()];
  if (!rows.length) return;
  if (rows.length > ADMIN_BULK_MAX) { toast(tr('adminBulkTooMany', { max: ADMIN_BULK_MAX })); return; }

  const word = tr('adminBulkConfirmWord');
  const proceed = await confirmDialog(
    tr('adminArtDeleteMessage', { n: rows.length, word }),
    { title: tr('adminArtDeleteTitle'), okLabel: tr('deleteLabel'), confirmText: word }
  );
  if (!proceed) return;

  const btn = document.getElementById('adminArtDeleteBtn');
  btn.disabled = true;
  let done = 0, refused = 0, failed = 0, filesGone = 0, filesFailed = 0;
  for (const sub of rows) {
    // Row first: that is what takes it off the site. Its URLs are already in
    // hand, so the file cleanup below doesn't depend on the row surviving —
    // and a Storage policy that isn't applied yet can't block moderation.
    const res = await adminDeleteRow('mosaic_submissions', sub.id);
    if (!res.ok) {
      if (res.refused) refused++; else { failed++; console.error('admin delete artwork error:', res.error); }
      continue;
    }
    done++;
    const paths = adminStoragePaths(sub);
    if (paths.length) {
      const { error: sErr } = await sb.storage.from('artwork').remove(paths);
      if (sErr) { filesFailed += paths.length; console.error('remove artwork files error:', sErr); }
      else filesGone += paths.length;
    }
    await adminLogAction('artwork_delete', 'submission', sub.id, {
      title: sub.art_title || null, author: sub.author_name || null, files: paths.length,
    });
  }
  btn.disabled = false;

  // One toast: each call replaces the last, so separate ones would hide
  // everything but the final line.
  const said = [];
  if (done) said.push(tr('adminArtDeleted', { n: done, files: filesGone }));
  if (refused) said.push(tr('adminDeleteRefused'));
  if (failed) said.push(tr('adminBulkPartial', { done, failed }));
  if (filesFailed) said.push(tr('adminArtFilesFailed', { n: filesFailed }));
  if (said.length) toast(said.join(' · '));
  // Files left behind, or nothing written to the log: both mean
  // supabase_admin_moderation.sql hasn't been applied — say so in the page,
  // not just in a toast that disappears.
  if (filesFailed || !adminLogAvailable) adminShow('adminArtUnavailable', true);

  await resetAdminArtworks();
  // Cells just opened up — give the pool a pass, same as every other path
  // that frees cells.
  placePooledPieces(false).then(() => { loadAdminUsage(); }).catch(e => console.error('pool matching after delete error:', e));
}

// ---------- comments tab ----------
const ADMIN_COM_PAGE = 50;
let adminComOffset = 0, adminComDone = false;
const adminComSelected = new Map();

async function resetAdminComments() {
  adminComOffset = 0; adminComDone = false;
  adminComSelected.clear();
  document.getElementById('adminComments').innerHTML = '';
  document.getElementById('adminComSelectAll').checked = false;
  syncAdminComBar();
  await loadMoreAdminComments();
}

async function loadMoreAdminComments() {
  const btn = document.getElementById('adminComMoreBtn');
  btn.disabled = true;
  const { data, error } = await sb.from('mosaic_submission_comments')
    .select('id,submission_id,author_id,author_name,body,created_at')
    .order('created_at', { ascending: false })
    .range(adminComOffset, adminComOffset + ADMIN_COM_PAGE - 1);
  btn.disabled = false;
  if (error) { console.error('load admin comments error:', error); toast(tr('adminLoadError')); return; }

  const rows = data || [];
  // One lookup for the artwork each comment sits on, so the row can link out.
  const subIds = [...new Set(rows.map(r => r.submission_id).filter(Boolean))];
  const { data: subs } = subIds.length
    ? await sb.from('mosaic_submissions').select('id,art_title').in('id', subIds)
    : { data: [] };
  const titleBy = new Map((subs || []).map(s => [String(s.id), s.art_title]));

  const list = document.getElementById('adminComments');
  for (const c of rows) list.appendChild(adminCommentRowEl(c, titleBy));
  adminComOffset += rows.length;
  adminComDone = rows.length < ADMIN_COM_PAGE;
  adminShow('adminComEmpty', adminComOffset === 0);
  btn.style.display = adminComDone ? 'none' : '';
  syncAdminComBar();
}

function adminCommentRowEl(c, titleBy) {
  const row = document.createElement('div');
  row.className = 'admin-row admin-comment';

  const check = document.createElement('input');
  check.type = 'checkbox'; check.className = 'admin-com-check';
  check.checked = adminComSelected.has(c.id);
  check.setAttribute('aria-label', c.body.slice(0, 40));
  check.onchange = () => {
    if (check.checked) adminComSelected.set(c.id, c); else adminComSelected.delete(c.id);
    row.classList.toggle('selected', check.checked);
    syncAdminComBar();
  };
  row.classList.toggle('selected', check.checked);

  const meta = document.createElement('div'); meta.className = 'admin-meta';
  const body = document.createElement('div'); body.className = 'admin-com-body'; body.textContent = c.body;
  const sub = document.createElement('div'); sub.className = 'admin-sub';
  sub.append(`${c.author_name || tr('anonymous')} · ${adminDate(c.created_at)} · `);
  if (c.submission_id) {
    const link = document.createElement('a');
    link.className = 'admin-target-label'; link.href = artworkUrl(c.submission_id);
    link.target = '_blank'; link.rel = 'noopener';
    link.textContent = titleBy.get(String(c.submission_id)) || tr('adminNoTitle');
    sub.appendChild(link);
  } else {
    sub.append(tr('adminTargetMissing'));
  }
  meta.append(body, sub);

  row.append(check, meta);
  return row;
}

function syncAdminComBar() {
  const n = adminComSelected.size;
  const btn = document.getElementById('adminComDeleteBtn');
  btn.disabled = n === 0;
  btn.textContent = n ? tr('adminDeleteSelectedN', { n }) : tr('adminDeleteSelected');
  document.getElementById('adminComCount').textContent =
    tr('adminShownSelected', { shown: adminComOffset, selected: n });
}

async function deleteSelectedComments() {
  const rows = [...adminComSelected.values()];
  if (!rows.length) return;
  if (rows.length > ADMIN_BULK_MAX) { toast(tr('adminBulkTooMany', { max: ADMIN_BULK_MAX })); return; }

  const word = tr('adminBulkConfirmWord');
  const proceed = await confirmDialog(
    tr('adminComDeleteMessage', { n: rows.length, word }),
    { title: tr('adminComDeleteTitle'), okLabel: tr('deleteLabel'), confirmText: word }
  );
  if (!proceed) return;

  const btn = document.getElementById('adminComDeleteBtn');
  btn.disabled = true;
  let done = 0, refused = 0, failed = 0;
  for (const c of rows) {
    const res = await adminDeleteRow('mosaic_submission_comments', c.id);
    if (!res.ok) {
      if (res.refused) refused++; else { failed++; console.error('admin delete comment error:', res.error); }
      continue;
    }
    done++;
    await adminLogAction('comment_delete', 'comment', c.id, { author: c.author_name || null, submission: c.submission_id || null });
  }
  btn.disabled = false;

  // Until supabase_admin_moderation.sql runs, the delete policy still only
  // covers the comment's own author and the artwork's author, so an admin's
  // delete is silently refused rather than failing.
  if (refused) adminShow('adminComUnavailable', true);
  const said = [];
  if (done) said.push(tr('adminComDeleted', { n: done }));
  if (refused) said.push(tr('adminDeleteRefused'));
  if (failed) said.push(tr('adminBulkPartial', { done, failed }));
  if (said.length) toast(said.join(' · '));
  await resetAdminComments();
}

// ---------- announcement tab: one message to every member ----------
// The send itself is admin_broadcast_notification (supabase_admin_broadcast.sql),
// which writes one notifications row per member and lets the EXISTING pg_net
// trigger fan them out — the same path a like or a comment already takes. So
// there is nothing here that can break per-event push.
//
// This cannot be undone: once the rows exist the trigger has already fired.
// Hence the typed confirmation, the live preview of what a phone will show,
// and the recipient count next to the button.
let adminBroadcastAvailable = true;
let adminBroadcastSending = false;

function adminBroadcastFields() {
  return {
    title: document.getElementById('adminBroadcastTitle'),
    body: document.getElementById('adminBroadcastBody'),
    btn: document.getElementById('adminBroadcastSendBtn'),
  };
}

// The preview is deliberately shaped like a notification rather than like a
// form field: the title truncating to one line is exactly the failure we hit
// on iOS in 2026-09, and an admin should see it here instead of afterwards.
function renderAdminBroadcastPreview() {
  const { title, body, btn } = adminBroadcastFields();
  if (!title || !body || !btn) return;
  const t = title.value.trim();
  const b = body.value.trim();
  document.getElementById('adminBroadcastPreviewTitle').textContent = t || tr('adminBroadcastPreviewEmpty');
  document.getElementById('adminBroadcastPreviewBody').textContent = b;
  document.getElementById('adminBroadcastTitleCount').textContent = title.value.length;
  document.getElementById('adminBroadcastBodyCount').textContent = body.value.length;
  document.getElementById('adminBroadcastPreview').classList.toggle('is-empty', !t);
  btn.disabled = !adminBroadcastAvailable || adminBroadcastSending || !t;
}

async function loadAdminBroadcast() {
  const { title, body } = adminBroadcastFields();
  if (!title || !body) return;

  // Probing for the notifications.title column tells us whether
  // supabase_admin_broadcast.sql has been run — the same file adds the
  // column and the RPC. Calling the RPC to find out is not an option: it
  // would send the announcement.
  const { error } = await sb.from('notifications').select('title').limit(1);
  if (error && (error.code === '42703' || error.code === 'PGRST204' || error.code === 'PGRST205')) {
    adminBroadcastAvailable = false;
    adminShow('adminBroadcastUnavailable', true);
  } else if (error) {
    console.error('broadcast availability probe error:', error);
  }

  if (adminBroadcastAvailable) {
    title.disabled = false;
    body.disabled = false;
    const { count, error: cErr } = await sb.from('profiles').select('id', { count: 'exact', head: true });
    if (cErr) console.error('load member count error:', cErr);
    else document.getElementById('adminBroadcastTargets').textContent = tr('adminBroadcastTargets', { n: count ?? 0 });
  }

  title.oninput = renderAdminBroadcastPreview;
  body.oninput = renderAdminBroadcastPreview;
  document.getElementById('adminBroadcastSendBtn').onclick = sendAdminBroadcast;
  renderAdminBroadcastPreview();
}

async function sendAdminBroadcast() {
  if (!adminBroadcastAvailable || adminBroadcastSending) return;
  const { title, body, btn } = adminBroadcastFields();
  const t = title.value.trim();
  const b = body.value.trim();
  if (!t) { toast(tr('adminBroadcastNeedTitle')); return; }

  const word = tr('adminBroadcastConfirmWord');
  const proceed = await confirmDialog(
    tr('adminBroadcastMessage', { title: t, word }),
    { title: tr('adminBroadcastTitleAsk'), okLabel: tr('adminBroadcastSendLabel'), confirmText: word }
  );
  if (!proceed) return;

  // Guard against a second send while the first is in flight: a duplicate
  // announcement reaches every member's lock screen twice and cannot be
  // recalled.
  adminBroadcastSending = true;
  btn.disabled = true;
  const { data, error } = await sb.rpc('admin_broadcast_notification', { p_title: t, p_body: b || null });
  adminBroadcastSending = false;
  if (error) {
    console.error('broadcast error:', error);
    toast(tr('adminBroadcastFailed'));
    renderAdminBroadcastPreview();
    return;
  }
  toast(tr('adminBroadcastSent', { n: data ?? 0 }));
  title.value = '';
  body.value = '';
  renderAdminBroadcastPreview();
  // The log tab reloads on its next visit anyway, but if it is already
  // loaded this keeps it honest.
  adminTabsLoaded.delete('log');
}

// ---------- members tab: upload block ----------
let adminBlockAvailable = true;
const ADMIN_PROFILE_COLS = 'id,username,name,avatar_url,upload_blocked';

async function fetchAdminProfiles(apply) {
  let { data, error } = await apply(sb.from('profiles').select(ADMIN_PROFILE_COLS));
  if (error && isSchemaMismatchError(error)) {
    adminBlockAvailable = false;
    adminShow('adminBlockUnavailable', true);
    return { data: null, error };
  }
  return { data, error };
}

async function loadAdminBlocked() {
  if (!adminBlockAvailable) return;
  const { data, error } = await fetchAdminProfiles(q => q.eq('upload_blocked', true).order('username').limit(100));
  if (error) { if (!isSchemaMismatchError(error)) console.error('load blocked profiles error:', error); return; }
  const rows = data || [];
  const list = document.getElementById('adminBlockedList');
  list.innerHTML = '';
  adminShow('adminBlockedEmpty', rows.length === 0);
  for (const p of rows) list.appendChild(adminProfileRowEl(p));
}

async function searchAdminMembers() {
  const term = document.getElementById('adminBlockSearch').value.trim();
  const list = document.getElementById('adminBlockResults');
  list.innerHTML = '';
  // Without the upload_blocked column there is nothing to do with a result.
  if (!term || !adminBlockAvailable) return;
  const { data, error } = await fetchAdminProfiles(q => q.ilike('username', `%${term}%`).order('username').limit(20));
  if (error) { if (!isSchemaMismatchError(error)) { console.error('search profiles error:', error); toast(tr('adminLoadError')); } return; }
  const rows = data || [];
  if (!rows.length) { toast(tr('adminBlockNoResults')); return; }
  for (const p of rows) list.appendChild(adminProfileRowEl(p));
}

function adminProfileRowEl(p) {
  const row = document.createElement('div');
  row.className = 'admin-row admin-admin';

  const name = p.username || p.name || tr('anonymous');
  const target = document.createElement('div'); target.className = 'admin-target';
  target.appendChild(miniAvatarEl(name, p.avatar_url, p.id));
  const label = document.createElement('a');
  label.className = 'admin-target-label';
  label.href = profileUrl(p.username || p.id);
  label.target = '_blank'; label.rel = 'noopener';
  label.textContent = name;
  target.appendChild(label);

  const meta = document.createElement('div'); meta.className = 'admin-meta';
  if (p.upload_blocked) {
    const badge = document.createElement('span');
    badge.className = 'admin-badge admin-status-open'; badge.textContent = tr('adminBlockedBadge');
    meta.appendChild(badge);
  }

  const actions = document.createElement('div'); actions.className = 'admin-actions';
  actions.appendChild(adminActionBtn(
    p.upload_blocked ? tr('adminUnblockLabel') : tr('adminBlockLabel'),
    () => setAdminUploadBlocked(p, !p.upload_blocked),
    p.upload_blocked ? '' : 'danger'
  ));

  row.append(target, meta, actions);
  return row;
}

async function setAdminUploadBlocked(p, blocked) {
  const name = p.username || p.name || tr('anonymous');
  if (blocked) {
    const proceed = await confirmDialog(tr('adminBlockMessage', { name }), { title: tr('adminBlockTitle'), okLabel: tr('adminBlockLabel') });
    if (!proceed) return;
  }
  const { error } = await sb.rpc('admin_set_upload_blocked', { p_user: p.id, p_blocked: blocked });
  if (error) {
    console.error('admin_set_upload_blocked error:', error);
    if (isSchemaMismatchError(error)) { adminShow('adminBlockUnavailable', true); toast(tr('adminBlockUnavailableToast')); return; }
    toast(tr('adminBlockFailed')); return;
  }
  toast(blocked ? tr('adminBlockDone', { name }) : tr('adminUnblockDone', { name }));
  // The RPC logs the change itself, so only the two lists need refreshing.
  await Promise.all([loadAdminBlocked(), searchAdminMembers()]);
  if (adminTabsLoaded.has('log')) loadAdminLog();
}

// ---------- open-report count on the tab, whichever tab is showing ----------
async function loadAdminReportsBadge() {
  const badge = document.getElementById('adminReportsBadge');
  const { count, error } = await sb.from('reports').select('id', { count: 'exact', head: true }).eq('status', 'open');
  if (error) { console.error('report count error:', error); return; }
  badge.textContent = String(count || 0);
  badge.hidden = !count;
}

// ---------- tabs ----------
// One section per tab, loaded the first time it is opened — the page used to
// fire nine requests before showing anything. The hash keeps a tab across a
// refresh and makes it linkable.
const ADMIN_TAB_LOADERS = {
  dashboard: () => Promise.all([loadAdminVisits(), loadAdminUsage()]),
  reports:   () => loadAdminReports(),
  artworks:  () => resetAdminArtworks(),
  comments:  () => resetAdminComments(),
  campaigns: () => loadAdminCampaigns(),
  tools:     () => Promise.all([loadAdminPool(), loadAdminPieces(), loadAdminThumbs(), loadAdminPixel()]),
  members:   () => Promise.all([loadAdminNewMembers(), loadAdminAdmins(), loadAdminBlocked()]),
  broadcast: () => loadAdminBroadcast(),
  settings:  () => loadAdminSettings(),
  log:       () => loadAdminLog(),
};
const ADMIN_DEFAULT_TAB = 'dashboard';
const adminTabsLoaded = new Set();

function adminTabFromHash() {
  const want = decodeURIComponent((location.hash || '').replace(/^#/, ''));
  return Object.prototype.hasOwnProperty.call(ADMIN_TAB_LOADERS, want) ? want : ADMIN_DEFAULT_TAB;
}

function showAdminTab(name) {
  document.querySelectorAll('.admin-tab').forEach(btn => {
    const on = btn.dataset.tab === name;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  document.querySelectorAll('.admin-panel').forEach(panel => { panel.hidden = panel.dataset.panel !== name; });
  if (adminTabsLoaded.has(name)) return;
  adminTabsLoaded.add(name);
  Promise.resolve(ADMIN_TAB_LOADERS[name]()).catch(err => console.error(`admin tab "${name}" load error:`, err));
}

// ---------- boot ----------
async function loadAdminPage() {
  const isAdmin = !!(me.id && me.isAdmin);
  adminShow('adminNotice', !isAdmin);
  adminShow('adminBody', isAdmin);
  if (!isAdmin) return;
  adminTabsLoaded.clear(); // a sign-in/out re-runs this: every tab is stale
  showAdminTab(adminTabFromHash());
  loadAdminReportsBadge().catch(err => console.error('report badge error:', err));
}

document.getElementById('adminTabs').addEventListener('click', e => {
  const btn = e.target.closest('.admin-tab');
  if (!btn) return;
  // Setting the hash fires hashchange, which does the actual switch.
  if (adminTabFromHash() === btn.dataset.tab) showAdminTab(btn.dataset.tab);
  else location.hash = btn.dataset.tab;
});
window.addEventListener('hashchange', () => { if (me.id && me.isAdmin) showAdminTab(adminTabFromHash()); });

document.getElementById('adminReportsShowAll').onchange = () => loadAdminReports();
const reloadAdminArtworks = () => resetAdminArtworks().catch(err => console.error('admin artworks reload error:', err));

document.getElementById('adminArtRange').onchange = reloadAdminArtworks;
document.getElementById('adminArtAuthor').onchange = reloadAdminArtworks;
document.getElementById('adminArtMoreBtn').onclick = () => loadMoreAdminArtworks().catch(err => console.error('admin artworks page error:', err));
document.getElementById('adminArtDeleteBtn').onclick = () => deleteSelectedArtworks().catch(err => console.error('admin artwork delete error:', err));
// "Select all" stops at the per-action cap rather than ticking 60 boxes the
// delete would then refuse.
// Each change event updates `selected` synchronously, so the cap below sees
// the running total.
function adminSelectAll(selector, on, selected) {
  let truncated = false;
  document.querySelectorAll(selector).forEach(check => {
    if (on && !check.checked && selected.size >= ADMIN_BULK_MAX) { truncated = true; return; }
    if (check.checked === on) return;
    check.checked = on;
    check.dispatchEvent(new Event('change'));
  });
  if (truncated) toast(tr('adminSelectAllCapped', { max: ADMIN_BULK_MAX }));
}
document.getElementById('adminArtSelectAll').onchange = e =>
  adminSelectAll('#adminArtGrid .admin-art-check', e.target.checked, adminArtSelected);
document.getElementById('adminComMoreBtn').onclick = () => loadMoreAdminComments().catch(err => console.error('admin comments page error:', err));
document.getElementById('adminComDeleteBtn').onclick = () => deleteSelectedComments().catch(err => console.error('admin comment delete error:', err));
document.getElementById('adminComSelectAll').onchange = e =>
  adminSelectAll('#adminComments .admin-com-check', e.target.checked, adminComSelected);
document.getElementById('adminBlockSearchBtn').onclick = () => searchAdminMembers().catch(err => console.error('admin member search error:', err));
document.getElementById('adminBlockSearch').onkeydown = e => { if (e.key === 'Enter') searchAdminMembers().catch(err => console.error('admin member search error:', err)); };

document.addEventListener('weavo:authchange', () => loadAdminPage());
authReady.then(() => loadAdminPage());
