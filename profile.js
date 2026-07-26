// ---------- individual profile view ----------
// Self-contained module: injects its own styles/markup and wires up the
// profile page (avatar/bio/links, artwork grid, comments). The main app
// script is a single closure with no globals, so this exposes a factory
// on `window` that takes its dependencies explicitly and hands back the
// two entry points the rest of the app needs.
window.ProfileView = function ProfileView(deps) {
  const {
    sb, me, LINK_PLATFORMS, fadeIn, fadeOut, artSVG, openBlockModal, rowToRec, toast,
    getViewMode, setViewMode, getTransitioning, setTransitioning,
    getProfileReturnMode, setProfileReturnMode,
  } = deps;

  injectProfileStyles();
  injectProfileMarkup();

  function injectProfileStyles() {
    const style = document.createElement('style');
    style.textContent = `
  /* ── Profile view ───────────────────────────────────────────────────── */
  #profile-view {
    position:fixed; inset:0; background:var(--bg); overflow-y:auto;
    display:none; padding:118px 24px 48px;
  }
  #profile-header { max-width:640px; margin:0 auto 28px; display:flex; align-items:center; gap:20px; }
  #profile-avatar, #profile-avatar-fallback {
    width:84px; height:84px; border-radius:50%; object-fit:cover; background:#e0e0e0; flex-shrink:0;
  }
  #profile-avatar-fallback { display:flex; align-items:center; justify-content:center; font-weight:700; font-size:30px; color:var(--muted); }
  #profile-info { min-width:0; }
  #profile-name { font-size:19px; font-weight:700; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  #profile-bio { font-size:13px; color:var(--ink); line-height:1.5; margin-top:5px; }
  #profile-tags { display:flex; flex-wrap:wrap; gap:5px; margin-top:8px; }
  #profile-stats { font-size:12px; color:var(--muted); margin-top:8px; }
  #profile-links { display:flex; flex-wrap:wrap; gap:8px; margin-top:10px; }
  .profile-link {
    display:inline-flex; align-items:center; gap:5px; padding:5px 11px; border-radius:999px;
    background:#f0f0f0; color:var(--ink); font-size:11.5px; font-weight:600; text-decoration:none;
    transition:background .12s ease;
  }
  .profile-link:hover { background:#e0e0e0; }
  #profile-grid {
    max-width:640px; margin:0 auto; display:grid;
    grid-template-columns:repeat(3, 1fr); gap:4px;
  }
  .profile-thumb {
    position:relative; aspect-ratio:1; overflow:hidden; cursor:pointer;
    background:#f0f0f0; border-radius:4px; transition:opacity .12s ease;
  }
  .profile-thumb:hover { opacity:0.85; }
  .profile-thumb img, .profile-thumb svg { width:100%; height:100%; display:block; object-fit:cover; }
  .profile-thumb .pt-pending { display:flex; align-items:center; justify-content:center; width:100%; height:100%; }
  .profile-thumb .pt-pending .dot { width:14px; height:14px; border-radius:50%; background:#aaaaaa; opacity:.7; }
  #profile-empty { text-align:center; color:var(--muted); font-size:13px; padding:60px 0; display:none; }
  #profile-projects { max-width:640px; margin:32px auto 0; display:none; }
  #profile-projects-heading {
    font-size:12px; font-weight:700; color:var(--muted); text-transform:uppercase;
    letter-spacing:.04em; margin-bottom:10px;
  }
  #profile-projects-list { display:flex; flex-direction:column; gap:8px; }
  .profile-project-card {
    display:flex; align-items:center; gap:12px; padding:10px 12px; border-radius:8px;
    background:#f7f7f7; text-decoration:none; color:var(--ink); transition:background .12s ease;
  }
  .profile-project-card:hover { background:#eee; }
  .profile-project-thumb {
    width:44px; height:44px; border-radius:6px; object-fit:cover; flex-shrink:0; background:#e0e0e0;
  }
  .profile-project-info { min-width:0; }
  .profile-project-title { font-size:13.5px; font-weight:700; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .profile-project-archived-badge {
    display:inline-block; font-size:9.5px; font-weight:700; text-transform:uppercase; letter-spacing:.04em;
    color:var(--muted); background:#e8e8e8; border-radius:999px; padding:1px 7px; vertical-align:middle;
  }
  .profile-project-count { font-size:11.5px; color:var(--muted); margin-top:2px; }
  #profile-saved { max-width:640px; margin:32px auto 0; display:none; }
  #profile-saved-heading {
    font-size:12px; font-weight:700; color:var(--muted); text-transform:uppercase;
    letter-spacing:.04em; margin-bottom:10px;
  }
  #profile-saved-grid { display:grid; grid-template-columns:repeat(3, 1fr); gap:4px; }
  #profile-comments { max-width:640px; margin:32px auto 0; }
  #profile-comments-heading {
    font-size:12px; font-weight:700; color:var(--muted); text-transform:uppercase;
    letter-spacing:.04em; margin-bottom:10px;
  }
  #profile-comment-form { display:flex; flex-direction:column; gap:8px; margin-bottom:16px; }
  #profile-comment-input {
    width:100%; box-sizing:border-box; border:1px solid var(--panel-border); border-radius:6px;
    padding:10px 12px; font:inherit; font-size:13px; line-height:1.4; resize:vertical; min-height:56px;
  }
  #profile-comment-input:focus { border-color:var(--accent); outline:none; }
  #profile-comment-post {
    align-self:flex-end; padding:6px 16px; border-radius:6px; border:none;
    background:var(--accent); color:#fff; font-size:12.5px; font-weight:600; cursor:pointer;
  }
  #profile-comment-post:disabled { opacity:.5; cursor:default; }
  #profile-comments-list {
    display:flex; flex-direction:column; gap:1px; background:var(--panel-border);
    border-radius:6px; overflow:hidden;
  }
  .profile-comment-item { background:#fff; padding:12px 14px; display:flex; flex-direction:column; gap:4px; }
  .profile-comment-item .pc-head { display:flex; align-items:center; justify-content:space-between; gap:8px; }
  .profile-comment-item .pc-author-time { display:flex; align-items:baseline; gap:8px; min-width:0; }
  .profile-comment-item .pc-author { font-size:12.5px; font-weight:600; color:var(--ink); cursor:pointer; }
  .profile-comment-item .pc-author:hover { text-decoration:underline; }
  .profile-comment-item .pc-time { font-size:11px; color:var(--muted); flex-shrink:0; }
  .profile-comment-item .pc-delete {
    font-size:11px; color:var(--muted); background:none; border:none; cursor:pointer; padding:0; flex-shrink:0;
  }
  .profile-comment-item .pc-delete:hover { color:#c0392b; }
  .profile-comment-item .pc-body { font-size:13px; line-height:1.5; color:var(--ink); word-break:break-word; }
  #profile-comments-empty { text-align:center; color:var(--muted); font-size:13px; padding:16px 0; display:none; }
  #profile-graph { max-width:640px; margin:32px auto 0; }
  #profile-graph-heading { font-size:12px; font-weight:700; color:var(--muted); text-transform:uppercase; letter-spacing:.04em; margin-bottom:4px; }
  #profile-graph-sub { font-size:12px; color:var(--muted); line-height:1.5; margin-bottom:10px; }
  #profile-graph-panel { position:relative; border:1px solid var(--panel-border); border-radius:10px; background:#fafafa; height:360px; overflow:hidden; }
  #profile-graph-svg { width:100%; height:100%; display:block; cursor:grab; }
  #profile-graph-svg:active { cursor:grabbing; }
  #profile-graph-crumb {
    position:absolute; top:10px; left:10px; z-index:2; display:none; align-items:center; gap:8px;
    background:rgba(255,255,255,0.92); border:1px solid var(--panel-border); border-radius:999px;
    padding:4px 10px 4px 6px; font-size:11.5px; max-width:calc(100% - 20px);
  }
  #profile-graph-back {
    appearance:none; border:none; background:none; cursor:pointer; font:inherit; font-weight:700;
    color:var(--ink); padding:2px 4px; flex-shrink:0;
  }
  #profile-graph-crumb-label { color:var(--muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  #profile-graph-crumb-visit { color:var(--ink); font-weight:600; text-decoration:none; flex-shrink:0; }
  #profile-graph-crumb-visit:hover { text-decoration:underline; }
  #profile-graph-empty {
    position:absolute; inset:0; display:none; align-items:center; justify-content:center;
    color:var(--muted); font-size:13px; text-align:center; padding:0 24px;
  }
  .pg-node { cursor:pointer; }
  .pg-node .pg-ring { fill:none; stroke:var(--panel-border); stroke-width:1.5px; }
  .pg-node.pg-center .pg-ring { stroke:var(--ink); stroke-width:2px; }
  .pg-node .pg-fallback { fill:#e8e8e8; }
  .pg-node .pg-fallback-label { fill:var(--muted); font-weight:700; text-anchor:middle; dominant-baseline:central; pointer-events:none; }
  .pg-label { font-size:10px; fill:var(--ink); font-weight:600; text-anchor:middle; pointer-events:none; }
  .pg-link { stroke:#cccccc; stroke-width:1.4px; fill:none; }
  .pg-link.pg-mutual { stroke:#111111; stroke-width:1.6px; }
    `;
    document.head.appendChild(style);
  }

  function injectProfileMarkup() {
    const wrap = document.createElement('div');
    wrap.innerHTML = `
  <!-- Individual user profile view -->
  <div id="profile-view">
    <div id="profile-header">
      <img id="profile-avatar" style="display:none" alt="">
      <div id="profile-avatar-fallback" style="display:none"></div>
      <div id="profile-info">
        <div id="profile-name"></div>
        <div id="profile-bio"></div>
        <div id="profile-tags"></div>
        <div id="profile-stats"></div>
        <div id="profile-links"></div>
      </div>
    </div>
    <div id="profile-grid"></div>
    <div id="profile-empty">No approved pieces yet.</div>
    <div id="profile-projects">
      <div id="profile-projects-heading">Projects Participated In</div>
      <div id="profile-projects-list"></div>
    </div>
    <div id="profile-saved">
      <div id="profile-saved-heading">Saved Artwork</div>
      <div id="profile-saved-grid"></div>
    </div>
    <div id="profile-comments">
      <div id="profile-comments-heading">Comments</div>
      <div id="profile-comment-form" style="display:none;">
        <textarea id="profile-comment-input" placeholder="Leave a comment…" maxlength="280"></textarea>
        <button id="profile-comment-post">Post</button>
      </div>
      <div id="profile-comments-list"></div>
      <div id="profile-comments-empty">No comments yet.</div>
    </div>
    <div id="profile-graph">
      <div id="profile-graph-heading">Network</div>
      <div id="profile-graph-sub">Saves connect people to the artists whose work they've bookmarked. Drag to rearrange, scroll to zoom, click a node to explore.</div>
      <div id="profile-graph-panel">
        <div id="profile-graph-crumb">
          <button id="profile-graph-back">← Back</button>
          <span id="profile-graph-crumb-label"></span>
          <a id="profile-graph-crumb-visit" href="#">View profile →</a>
        </div>
        <svg id="profile-graph-svg"></svg>
        <div id="profile-graph-empty">No saves yet — nothing to map.</div>
      </div>
    </div>
  </div>
    `;
    // Insert ahead of #grid-viewport (its original position) so it doesn't
    // paint over #nav-bar and the other fixed-position panels that follow it.
    document.body.insertBefore(wrap.firstElementChild, document.getElementById('grid-viewport'));
  }

  async function fetchUserArtworks(authorId) {
    const { data, error } = await sb.from('cells').select('*').eq('author_id', authorId).eq('approved', true).order('ts', { ascending: false });
    if (error || !data) return [];
    return data.map(rowToRec);
  }
  function profileThumbEl(rec) {
    const el = document.createElement('div');
    el.className = 'profile-thumb';
    if (rec.imageUrl) {
      const img = document.createElement('img');
      img.src = rec.imageUrl; img.alt = '';
      el.appendChild(img);
    } else {
      el.innerHTML = artSVG(rec.seed);
    }
    el.onclick = () => openBlockModal(rec);
    return el;
  }
  // Weavo artwork this profile's owner has saved (weavo.html's bookmark
  // button). Saves are public (see supabase_mosaic_likes.sql) so this shows
  // on anyone's profile, not just the owner's own view of it.
  async function fetchSavedWeavoArt(userId) {
    const { data, error } = await sb.from('mosaic_submission_saves')
      .select('created_at,mosaic_submissions(id,image_url,art_title,author_name,project_id,mosaic_projects(title))')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error || !data) return [];
    return data.map(row => row.mosaic_submissions).filter(Boolean);
  }
  // Distinct weavo projects this profile's owner has contributed artwork
  // to, with how many pieces they submitted to each. Submissions are public
  // (see supabase_mosaic.sql), so this shows on anyone's profile.
  //
  // A project can be reshaped (admin swaps its grid + reference image),
  // which freezes the pre-reshape grid as its own archived project row
  // instead of deleting it (supabase_mosaic_reshape.sql /
  // supabase_mosaic_versions.sql). mosaic_submissions.project_id always
  // tracks the *live* project (reshape repoints pixel_id, never
  // project_id), so that alone only ever surfaces the current project.
  // This additionally looks up, via mosaic_pixels, every archived project
  // whose frozen grid still shows one of this user's pieces — one card per
  // iteration they were actually part of, each with that iteration's own
  // title/image/count.
  async function fetchParticipatedProjects(userId) {
    const [{ data: live, error: liveErr }, { data: archived, error: archivedErr }] = await Promise.all([
      sb.from('mosaic_submissions')
        .select('project_id,mosaic_projects(id,title,reference_image_url)')
        .eq('author_id', userId),
      sb.from('mosaic_pixels')
        .select('project_id,mosaic_submissions!mosaic_pixels_submission_id_fkey!inner(author_id),mosaic_projects!inner(id,title,reference_image_url,is_archived,version_number)')
        .eq('mosaic_submissions.author_id', userId)
        .eq('mosaic_projects.is_archived', true)
    ]);
    const result = [];

    if (liveErr) console.error('load participated (live) projects error:', liveErr);
    if (live) {
      const byProject = new Map();
      for (const row of live) {
        const p = row.mosaic_projects;
        if (!p) continue;
        if (!byProject.has(p.id)) byProject.set(p.id, { ...p, count: 0, archived: false });
        byProject.get(p.id).count++;
      }
      result.push(...byProject.values());
    }

    if (archivedErr) console.error('load participated (archived) projects error:', archivedErr);
    if (archived) {
      const byProject = new Map();
      for (const row of archived) {
        const p = row.mosaic_projects;
        if (!p) continue;
        if (!byProject.has(p.id)) byProject.set(p.id, { ...p, count: 0, archived: true });
        byProject.get(p.id).count++;
      }
      result.push(...[...byProject.values()].sort((a, b) => b.version_number - a.version_number));
    }

    return result;
  }
  function profileProjectCardEl(project) {
    const a = document.createElement('a');
    a.className = 'profile-project-card';
    a.href = `weavo.html?project=${project.id}`;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';

    const img = document.createElement('img');
    img.className = 'profile-project-thumb';
    img.src = project.reference_image_url; img.alt = '';
    a.appendChild(img);

    const info = document.createElement('div');
    info.className = 'profile-project-info';
    const title = document.createElement('div');
    title.className = 'profile-project-title';
    title.textContent = project.title;
    if (project.archived) {
      const badge = document.createElement('span');
      badge.className = 'profile-project-archived-badge';
      badge.textContent = 'archived';
      title.appendChild(document.createTextNode(' '));
      title.appendChild(badge);
    }
    const count = document.createElement('div');
    count.className = 'profile-project-count';
    count.textContent = project.archived
      ? project.count + ' piece' + (project.count !== 1 ? 's' : '') + ' in this iteration'
      : project.count + ' piece' + (project.count !== 1 ? 's' : '') + ' contributed';
    info.append(title, count);
    a.appendChild(info);

    return a;
  }
  function profileSavedThumbEl(sub) {
    const a = document.createElement('a');
    a.className = 'profile-thumb';
    a.href = `weavo.html?project=${sub.project_id}`;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.title = sub.art_title || (sub.mosaic_projects && sub.mosaic_projects.title) || '';
    const img = document.createElement('img');
    img.src = sub.image_url; img.alt = '';
    a.appendChild(img);
    return a;
  }
  async function fetchProfileComments(profileId) {
    const { data, error } = await sb.from('profile_comments')
      .select('id,author_id,author_name,body,created_at')
      .eq('profile_id', profileId)
      .order('created_at', { ascending: false });
    if (error || !data) return [];
    return data;
  }
  function profileCommentEl(comment, profileId) {
    const el = document.createElement('div');
    el.className = 'profile-comment-item';

    const head = document.createElement('div');
    head.className = 'pc-head';

    const authorTime = document.createElement('div');
    authorTime.className = 'pc-author-time';
    const author = document.createElement('span');
    author.className = 'pc-author'; author.textContent = comment.author_name || 'Anonymous';
    author.onclick = () => enterProfileView(comment.author_id);
    const time = document.createElement('span');
    time.className = 'pc-time';
    time.textContent = new Date(comment.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    authorTime.append(author, time);
    head.appendChild(authorTime);

    if (me.id && (me.id === comment.author_id || me.id === profileId)) {
      const del = document.createElement('button');
      del.className = 'pc-delete'; del.textContent = 'Delete';
      del.onclick = () => deleteProfileComment(comment.id, profileId);
      head.appendChild(del);
    }
    el.appendChild(head);

    const body = document.createElement('div');
    body.className = 'pc-body'; body.textContent = comment.body;
    el.appendChild(body);

    return el;
  }
  async function renderProfileComments(profileId) {
    const list  = document.getElementById('profile-comments-list');
    const empty = document.getElementById('profile-comments-empty');
    list.innerHTML = '';
    const comments = await fetchProfileComments(profileId);
    empty.style.display = comments.length ? 'none' : 'block';
    for (const comment of comments) list.appendChild(profileCommentEl(comment, profileId));
  }
  async function deleteProfileComment(id, profileId) {
    const { error } = await sb.from('profile_comments').delete().eq('id', id);
    if (error) { toast('Could not delete comment'); return; }
    renderProfileComments(profileId);
  }
  function setupProfileCommentForm(profileId) {
    const form  = document.getElementById('profile-comment-form');
    const input = document.getElementById('profile-comment-input');
    const post  = document.getElementById('profile-comment-post');
    input.value = '';
    form.style.display = me.id ? 'flex' : 'none';
    post.onclick = async () => {
      const body = input.value.trim();
      if (!body) return;
      post.disabled = true;
      const { error } = await sb.from('profile_comments').insert({
        profile_id: profileId, author_id: me.id, author_name: me.username || me.name, body
      });
      post.disabled = false;
      if (error) { toast('Could not post comment'); return; }
      input.value = '';
      renderProfileComments(profileId);
    };
  }
  // ---------- network graph (Obsidian-style local graph of save relationships) ----------
  let graphSim    = null;  // running d3-force simulation, so it can be stopped on navigation
  let graphRootId = null;  // the profile this section was opened on, for the "Back" breadcrumb

  function nodeRadius(d) { return d.isCenter ? 22 : 16; }
  function truncateLabel(s) { return s.length > 14 ? s.slice(0, 13) + '…' : s; }
  function stopGraph() {
    if (graphSim) { graphSim.stop(); graphSim = null; }
  }
  function resetProfileGraph(userId) {
    stopGraph();
    graphRootId = userId;
    document.getElementById('profile-graph-svg').innerHTML = '';
    document.getElementById('profile-graph-crumb').style.display = 'none';
    document.getElementById('profile-graph-empty').style.display = 'none';
  }
  // Direct (1-hop) save relationships around `userId`: artists whose work
  // they've saved (outgoing) and people who've saved their work (incoming).
  // mosaic_submission_saves rows are public (supabase_mosaic_likes.sql), so
  // this works for any profile, not just the signed-in user's own.
  async function fetchGraphNeighbors(userId) {
    const [{ data: outRows, error: outErr }, { data: inRows, error: inErr }] = await Promise.all([
      sb.from('mosaic_submission_saves')
        .select('mosaic_submissions!inner(author_id)')
        .eq('user_id', userId),
      sb.from('mosaic_submission_saves')
        .select('user_id,mosaic_submissions!inner(author_id)')
        .eq('mosaic_submissions.author_id', userId),
    ]);
    if (outErr) console.error('load graph (outgoing) error:', outErr);
    if (inErr)  console.error('load graph (incoming) error:', inErr);

    const outCount = new Map(); // authorId -> # of that author's pieces userId has saved
    for (const row of (outRows || [])) {
      const authorId = row.mosaic_submissions && row.mosaic_submissions.author_id;
      if (!authorId || authorId === userId) continue;
      outCount.set(authorId, (outCount.get(authorId) || 0) + 1);
    }
    const inCount = new Map(); // saverId -> # of userId's pieces that saver has saved
    for (const row of (inRows || [])) {
      const saverId = row.user_id;
      if (!saverId || saverId === userId) continue;
      inCount.set(saverId, (inCount.get(saverId) || 0) + 1);
    }

    const ids = new Set([...outCount.keys(), ...inCount.keys()]);
    if (!ids.size) return [];

    const { data: profiles, error: profErr } = await sb.from('profiles')
      .select('id,name,username,avatar_url').in('id', [...ids]);
    if (profErr) console.error('load graph profiles error:', profErr);
    const profileById = new Map((profiles || []).map(p => [p.id, p]));

    return [...ids].map(id => {
      const p = profileById.get(id) || {};
      const out = outCount.get(id) || 0;
      const inn = inCount.get(id) || 0;
      return {
        id,
        label: p.username || p.name || 'Anonymous',
        avatar_url: p.avatar_url || '',
        direction: out && inn ? 'mutual' : (out ? 'out' : 'in'),
      };
    });
  }
  async function renderProfileGraphFor(centerId, isRoot) {
    const panel = document.getElementById('profile-graph-panel');
    const svgEl = document.getElementById('profile-graph-svg');
    const empty = document.getElementById('profile-graph-empty');
    const crumb = document.getElementById('profile-graph-crumb');
    const crumbLabel = document.getElementById('profile-graph-crumb-label');
    const crumbVisit = document.getElementById('profile-graph-crumb-visit');
    stopGraph();
    svgEl.innerHTML = '';

    const [{ data: centerProfile }, neighbors] = await Promise.all([
      sb.from('profiles').select('id,name,username,avatar_url').eq('id', centerId).maybeSingle(),
      fetchGraphNeighbors(centerId),
    ]);
    if (!centerProfile) return;

    const centerLabel = centerProfile.username || centerProfile.name || 'Anonymous';
    crumb.style.display = isRoot ? 'none' : 'flex';
    if (!isRoot) {
      crumbLabel.textContent = `viewing ${centerLabel}’s network`;
      crumbVisit.onclick = (e) => { e.preventDefault(); enterProfileView(centerId); };
    }
    document.getElementById('profile-graph-back').onclick = () => renderProfileGraphFor(graphRootId, true);

    empty.style.display = neighbors.length ? 'none' : 'flex';
    if (!neighbors.length) return;

    const width  = panel.clientWidth  || 592;
    const height = panel.clientHeight || 360;

    const centerNode = {
      id: centerProfile.id, label: centerLabel, avatar_url: centerProfile.avatar_url || '',
      isCenter: true, fx: width / 2, fy: height / 2,
    };
    const nodes = [centerNode, ...neighbors.map(n => ({ ...n }))];
    const links = neighbors.map(n => ({
      source: n.direction === 'in' ? n.id : centerNode.id,
      target: n.direction === 'in' ? centerNode.id : n.id,
      kind: n.direction,
    }));

    const svg = d3.select(svgEl).attr('viewBox', `0 0 ${width} ${height}`);
    const defs = svg.append('defs');
    const arrow = (id, fill) => defs.append('marker').attr('id', id)
      .attr('viewBox', '0 -5 10 10').attr('refX', 24).attr('refY', 0)
      .attr('markerWidth', 6).attr('markerHeight', 6).attr('orient', 'auto')
      .append('path').attr('d', 'M0,-5L10,0L0,5').attr('fill', fill);
    arrow('pg-arrow-out', '#bbbbbb');
    arrow('pg-arrow-in',  '#111111');

    const root = svg.append('g');
    svg.call(d3.zoom().scaleExtent([0.4, 2.5]).on('zoom', ev => root.attr('transform', ev.transform)));

    const link = root.append('g').selectAll('line').data(links).join('line')
      .attr('class', d => 'pg-link' + (d.kind === 'mutual' ? ' pg-mutual' : ''))
      .attr('marker-end', d => `url(#${d.kind === 'in' ? 'pg-arrow-in' : 'pg-arrow-out'})`);

    const node = root.append('g').selectAll('g').data(nodes).join('g')
      .attr('class', d => 'pg-node' + (d.isCenter ? ' pg-center' : ''));

    node.each(function (d) {
      const g = d3.select(this);
      const r = nodeRadius(d);
      if (d.avatar_url) {
        const clipId = 'pg-clip-' + d.id;
        defs.append('clipPath').attr('id', clipId).append('circle').attr('r', r);
        g.append('image').attr('href', d.avatar_url)
          .attr('x', -r).attr('y', -r).attr('width', r * 2).attr('height', r * 2)
          .attr('clip-path', `url(#${clipId})`).attr('preserveAspectRatio', 'xMidYMid slice');
        g.append('circle').attr('class', 'pg-ring').attr('r', r);
      } else {
        g.append('circle').attr('class', 'pg-ring pg-fallback').attr('r', r);
        g.append('text').attr('class', 'pg-fallback-label').attr('font-size', r).text(d.label.charAt(0).toUpperCase());
      }
      g.append('title').text(d.label);
    });

    const label = root.append('g').selectAll('text').data(nodes).join('text')
      .attr('class', 'pg-label').text(d => truncateLabel(d.label))
      .attr('dy', d => nodeRadius(d) + 12);

    const sim = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(links).id(d => d.id).distance(90).strength(0.6))
      .force('charge', d3.forceManyBody().strength(-260))
      .force('collide', d3.forceCollide(d => nodeRadius(d) + 14))
      .force('x', d3.forceX(width / 2).strength(0.05))
      .force('y', d3.forceY(height / 2).strength(0.05))
      .on('tick', () => {
        link.attr('x1', d => d.source.x).attr('y1', d => d.source.y)
            .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
        node.attr('transform', d => `translate(${d.x},${d.y})`);
        label.attr('x', d => d.x).attr('y', d => d.y);
      });
    graphSim = sim;

    let dragMoved = false;
    node.call(d3.drag()
      .on('start', (ev, d) => {
        dragMoved = false;
        if (!ev.active) sim.alphaTarget(0.3).restart();
        d.fx = d.x; d.fy = d.y;
      })
      .on('drag', (ev, d) => {
        dragMoved = true;
        d.fx = ev.x; d.fy = ev.y;
      })
      .on('end', (ev, d) => {
        if (!ev.active) sim.alphaTarget(0);
        if (d.isCenter) { d.fx = width / 2; d.fy = height / 2; }
        else if (!dragMoved) { d.fx = null; d.fy = null; }
      }));

    node.on('click', (ev, d) => {
      if (d.isCenter || dragMoved) return;
      ev.stopPropagation();
      renderProfileGraphFor(d.id, d.id === graphRootId);
    });
  }
  async function loadProfileView(userId) {
    const grid  = document.getElementById('profile-grid');
    const empty = document.getElementById('profile-empty');
    grid.innerHTML = '';
    empty.style.display = 'none';
    document.getElementById('profile-projects').style.display = 'none';
    document.getElementById('profile-projects-list').innerHTML = '';
    document.getElementById('profile-saved').style.display = 'none';
    document.getElementById('profile-saved-grid').innerHTML = '';
    document.getElementById('profile-comments-list').innerHTML = '';
    document.getElementById('profile-comments-empty').style.display = 'none';
    resetProfileGraph(userId);
    document.getElementById('profile-avatar').style.display = 'none';
    document.getElementById('profile-avatar-fallback').style.display = 'none';
    document.getElementById('profile-name').textContent = 'Loading…';
    document.getElementById('profile-bio').textContent = '';
    document.getElementById('profile-tags').innerHTML = '';
    document.getElementById('profile-stats').textContent = '';
    document.getElementById('profile-links').innerHTML = '';

    const [{ data: profile }, artworks, participatedProjects, savedWeavoArt] = await Promise.all([
      sb.from('profiles').select('id,name,username,avatar_url,bio,neurodivergence,links,created_at').eq('id', userId).maybeSingle(),
      fetchUserArtworks(userId),
      fetchParticipatedProjects(userId),
      fetchSavedWeavoArt(userId)
    ]);
    if (!profile) {
      document.getElementById('profile-name').textContent = 'User not found';
      return;
    }

    const displayName = profile.username || profile.name || 'Anonymous';
    document.getElementById('nav-label').textContent = displayName;
    document.getElementById('profile-name').textContent = displayName;
    if (profile.avatar_url) {
      const av = document.getElementById('profile-avatar');
      av.src = profile.avatar_url; av.style.display = 'block';
    } else {
      const fb = document.getElementById('profile-avatar-fallback');
      fb.textContent = displayName.charAt(0).toUpperCase();
      fb.style.display = 'flex';
    }
    document.getElementById('profile-bio').textContent = profile.bio || '';
    const tagsEl = document.getElementById('profile-tags');
    for (const tag of (profile.neurodivergence || []).filter(t => t !== 'Prefer not to say')) {
      const t = document.createElement('span'); t.className = 'nd-tag'; t.textContent = tag;
      tagsEl.appendChild(t);
    }
    const pieces = artworks.filter(rec => rec.imageUrl || !rec.body);

    const pieceLabel = pieces.length + ' piece' + (pieces.length !== 1 ? 's' : '');
    document.getElementById('profile-stats').textContent = pieceLabel + ' · Joined ' +
      new Date(profile.created_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    document.getElementById('nav-count').textContent = pieceLabel;
    const linksEl = document.getElementById('profile-links');
    for (const { key, label } of LINK_PLATFORMS) {
      const url = profile.links && profile.links[key];
      if (!url) continue;
      const a = document.createElement('a');
      a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer';
      a.className = 'profile-link'; a.textContent = label;
      linksEl.appendChild(a);
    }

    if (!pieces.length) empty.style.display = 'block';
    else for (const rec of pieces) grid.appendChild(profileThumbEl(rec));

    if (participatedProjects.length) {
      const projectsList = document.getElementById('profile-projects-list');
      for (const project of participatedProjects) projectsList.appendChild(profileProjectCardEl(project));
      document.getElementById('profile-projects').style.display = 'block';
    }

    if (savedWeavoArt.length) {
      const savedGrid = document.getElementById('profile-saved-grid');
      for (const sub of savedWeavoArt) savedGrid.appendChild(profileSavedThumbEl(sub));
      document.getElementById('profile-saved').style.display = 'block';
    }

    setupProfileCommentForm(userId);
    await renderProfileComments(userId);
  }
  async function enterProfileView(userId) {
    if (getTransitioning()) return;
    setTransitioning(true);
    const returnMode = getViewMode() === 'world' ? 'world' : 'users';
    setProfileReturnMode(returnMode);
    setViewMode('profile');

    document.getElementById('back-btn').textContent      = returnMode === 'world' ? '← World' : '← Users';
    document.getElementById('nav-swatch').style.display  = 'none';
    document.getElementById('nav-label').textContent     = 'Loading…';
    document.getElementById('nav-count').textContent     = '';
    document.getElementById('nav-bar').style.display     = 'flex';

    await Promise.all([
      fadeOut(document.getElementById('users-view')),
      fadeOut(document.getElementById('world-view')),
      fadeOut(document.getElementById('world-title')),
    ]);

    await loadProfileView(userId);
    await fadeIn(document.getElementById('profile-view'), 'block');
    // Deferred until after fadeIn: #profile-view is display:none until then,
    // so the graph panel would measure 0×0 and lay out its force sim wrong.
    renderProfileGraphFor(userId, true);
    setTransitioning(false);
  }
  async function exitProfileView() {
    if (getTransitioning()) return;
    setTransitioning(true);
    stopGraph();
    const returnMode = getProfileReturnMode();
    setViewMode(returnMode);
    document.getElementById('nav-bar').style.display = 'none';
    document.getElementById('tab-map').classList.toggle('active',   returnMode === 'world');
    document.getElementById('tab-users').classList.toggle('active', returnMode === 'users');
    await Promise.all([
      fadeOut(document.getElementById('profile-view')),
      fadeIn(document.getElementById('world-title'), 'block'),
      fadeIn(document.getElementById(returnMode === 'world' ? 'world-view' : 'users-view'), 'block'),
    ]);
    setTransitioning(false);
  }

  return { enterProfileView, exitProfileView };
};
