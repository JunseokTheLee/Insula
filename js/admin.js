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
}

// ---------- campaigns ----------
async function loadAdminCampaigns() {
  const [{ data: projects, error }, { data: placed }] = await Promise.all([
    sb.from('mosaic_projects').select('id,title,description,width,height,created_at,is_archived,version_number,grid_image_url,preview_image_url').order('created_at', { ascending: false }),
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
  const { data: updated, error } = await sb.from('mosaic_projects')
    .update({ title, description: description || null }).eq('id', p.id).select('id');
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
  const { data, error } = await fetchAllRows(() => sb.from('mosaic_submissions')
    .select('id,author_id,image_url,thumb_url,micro_thumb', { count: 'exact' })
    .or('thumb_url.is.null,micro_thumb.is.null'));
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
  const { data, error, count } = await sb.from('mosaic_submissions')
    .select('id,art_title,author_name,thumb_url,image_url,created_at', { count: 'exact' })
    .is('project_id', null)
    .order('created_at', { ascending: true })
    .limit(50);
  if (error) { console.error('load pool error:', error); toast(tr('adminLoadError')); return; }
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
async function loadAdminAdmins() {
  const { data, error } = await sb.from('profiles').select('id,username,avatar_url').eq('is_admin', true).order('username');
  if (error) { console.error('load admins error:', error); return; }
  const list = document.getElementById('adminAdmins');
  list.innerHTML = '';
  for (const p of data || []) {
    const row = document.createElement('div'); row.className = 'admin-row admin-admin';
    row.appendChild(miniAvatarEl(p.username || tr('anonymous'), p.avatar_url, p.id));
    const a = document.createElement('a'); a.className = 'admin-target-label'; a.href = profileUrl(p.username || p.id);
    a.textContent = p.username || tr('anonymous');
    if (p.id === me.id) { const you = document.createElement('span'); you.className = 'admin-badge'; you.textContent = tr('adminYou'); a.appendChild(document.createTextNode(' ')); a.appendChild(you); }
    row.appendChild(a);
    list.appendChild(row);
  }
}

// ---------- usage (DB / Storage) ----------
// admin_usage_stats() (supabase_mosaic_server_matching.sql §5) reads the
// database size and sums storage.objects. Monthly egress is a platform
// metric that only the Supabase dashboard has — the page says so instead of
// pretending. Section stays hidden until that SQL has been applied.
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
    adminSettingApply(input, adminSettingIsNumber(input) ? adminSettingNumber(settings[key], key) : adminSettingIsColor(input) ? adminSettingColor(settings[key], key) : !!settings[key]);
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
function adminSettingColor(v, key) {
  const raw = String(v || '').trim();
  return /^#[0-9a-f]{6}$/i.test(raw) ? raw.toUpperCase() : String(SITE_SETTING_DEFAULTS[key]).toUpperCase();
}
function adminSettingNumber(v, key) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : (Number(SITE_SETTING_DEFAULTS[key]) || 0);
}
function adminSettingValue(input) {
  if (adminSettingIsColor(input)) return adminSettingColor(input.value, input.dataset.setting);
  if (!adminSettingIsNumber(input)) return input.checked;
  const min = Number(input.min || 0), max = Number(input.max || 100);
  return Math.min(max, Math.max(min, adminSettingNumber(input.value, input.dataset.setting)));
}
function adminSettingApply(input, value) {
  if (adminSettingIsNumber(input)) input.value = String(value);
  else if (adminSettingIsColor(input)) input.value = adminSettingColor(value, input.dataset.setting).toLowerCase(); // <input type=color> wants lowercase
  else input.checked = !!value;
  input.dataset.saved = JSON.stringify(value);
  syncAdminSettingOutput(input);
}
function syncAdminSettingOutput(input) {
  if (!adminSettingIsNumber(input) && !adminSettingIsColor(input)) return;
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

// ---------- boot ----------
async function loadAdminPage() {
  const isAdmin = !!(me.id && me.isAdmin);
  adminShow('adminNotice', !isAdmin);
  adminShow('adminBody', isAdmin);
  if (!isAdmin) return;
  await Promise.all([loadAdminUsage(), loadAdminVisits(), loadAdminSettings(), loadAdminReports(), loadAdminCampaigns(), loadAdminPool(), loadAdminThumbs(), loadAdminAdmins()]);
}
document.getElementById('adminReportsShowAll').onchange = () => loadAdminReports();
document.addEventListener('weavo:authchange', () => loadAdminPage());
authReady.then(() => loadAdminPage());
