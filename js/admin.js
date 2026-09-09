// Admin page (/{lang}/admin): report queue, campaign list with per-campaign
// delete, and the admin roster. Everything here is gated twice — the page
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
    sb.from('mosaic_projects').select('id,title,width,height,created_at,is_archived,version_number').order('created_at', { ascending: false }),
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
    sub.textContent = `${tr('adminCells', { w: p.width, h: p.height, filled: filledBy.get(p.id) || 0 })} · ${tr('adminCreatedOn', { date: adminDate(p.created_at) })}`;
    main.append(title, sub);
    const actions = document.createElement('div'); actions.className = 'admin-actions';
    // Archived iterations can't be deleted on their own (the RPC refuses) —
    // they go away with their live campaign.
    if (!p.is_archived) actions.appendChild(adminActionBtn(tr('deleteLabel'), () => deleteAdminCampaign(p), 'danger'));
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
}

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

// ---------- boot ----------
async function loadAdminPage() {
  const isAdmin = !!(me.id && me.isAdmin);
  adminShow('adminNotice', !isAdmin);
  adminShow('adminBody', isAdmin);
  if (!isAdmin) return;
  await Promise.all([loadAdminReports(), loadAdminCampaigns(), loadAdminAdmins()]);
}
document.getElementById('adminReportsShowAll').onchange = () => loadAdminReports();
document.addEventListener('weavo:authchange', () => loadAdminPage());
authReady.then(() => loadAdminPage());
