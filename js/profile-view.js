// Profile page: header, contributed/submitted/saved artwork, and this
// user's own save-relationship graph. Reads the profile's user id from
// ?user= (falls back to the signed-in user once auth resolves, if none
// given). Needs common.js, auth.js, lightbox.js and js/graph-common.js.
"use strict";

function openProject(id) { location.href = `project.html?id=${encodeURIComponent(id)}`; }

let profileUserId = null;

document.getElementById('profileBackBtn').addEventListener('click', e => {
  e.preventDefault();
  stopGraph();
  const sameOriginReferrer = document.referrer && (() => {
    try { return new URL(document.referrer).origin === location.origin; } catch { return false; }
  })();
  if (sameOriginReferrer) history.back();
  else location.href = 'index.html';
});

async function fetchSubmittedWeavoArt(userId) {
  const { data, error } = await sb.from('mosaic_submissions')
    .select('id,pixel_id,project_id,image_url,art_title,art_description,art_link,author_id,author_name,author_avatar_url,created_at')
    .eq('author_id', userId)
    .order('created_at', { ascending: false });
  if (error) { console.error('load submitted weavo art error:', error); return []; }
  return data || [];
}
// Distinct projects this profile's owner has contributed artwork to, with
// how many pieces they submitted to each.
//
// A project can be reshaped (admin swaps its grid + reference image),
// which freezes the pre-reshape grid as its own archived project row
// (supabase_mosaic_reshape.sql) instead of deleting it. `submitted`
// always carries each submission's *live* project_id (reshape repoints
// pixel_id, never project_id), so that alone only ever surfaces the
// current project. This additionally looks up, via mosaic_pixels, every
// archived project whose frozen grid still shows one of this user's
// pieces — one card per iteration they were actually part of.
async function fetchParticipatedProjects(submitted, userId) {
  const result = [];
  if (submitted.length) {
    const ids = [...new Set(submitted.map(s => s.project_id))];
    const { data, error } = await sb.from('mosaic_projects')
      .select('id,title,reference_image_url')
      .in('id', ids);
    if (error) console.error('load participated (live) projects error:', error);
    if (data) {
      const projectById = new Map(data.map(p => [p.id, p]));
      const byProject = new Map();
      for (const sub of submitted) {
        const p = projectById.get(sub.project_id);
        if (!p) continue;
        if (!byProject.has(p.id)) byProject.set(p.id, { ...p, count: 0, archived: false });
        byProject.get(p.id).count++;
      }
      result.push(...byProject.values());
    }
  }
  {
    const { data: archived, error: archivedErr } = await sb.from('mosaic_pixels')
      .select('project_id,mosaic_submissions!mosaic_pixels_submission_id_fkey!inner(author_id),mosaic_projects!inner(id,title,reference_image_url,is_archived,version_number)')
      .eq('mosaic_submissions.author_id', userId)
      .eq('mosaic_projects.is_archived', true);
    if (archivedErr) console.error('load participated (archived) projects error:', archivedErr);
    if (archived) {
      const byProject = new Map();
      for (const row of archived) {
        const p = row.mosaic_projects;
        if (!p) continue;
        if (!byProject.has(p.id)) byProject.set(p.id, { ...p, count: 0, archived: true });
        byProject.get(p.id).count++;
      }
      result.push(...byProject.values());
    }
  }
  return result;
}
function profileProjectCardEl(project) {
  const card = document.createElement('div');
  card.className = 'pv-card';
  card.onclick = () => openProject(project.id);
  const thumb = document.createElement('div');
  thumb.className = 'pv-card-thumb';
  const img = document.createElement('img');
  img.src = project.reference_image_url; img.alt = '';
  thumb.appendChild(img);
  card.appendChild(thumb);
  const info = document.createElement('div');
  info.className = 'pv-card-info';
  const title = document.createElement('div');
  title.className = 'pv-card-title'; title.textContent = project.title;
  if (project.archived) {
    const badge = document.createElement('span');
    badge.className = 'pv-card-archived-badge';
    badge.textContent = tr('archivedBadge');
    title.appendChild(document.createTextNode(' '));
    title.appendChild(badge);
  }
  const count = document.createElement('div');
  count.className = 'pv-card-author';
  count.textContent = pieceContributedText(project.count);
  info.append(title, count);
  card.appendChild(info);
  return card;
}
async function fetchSavedWeavoArt(userId) {
  const { data, error } = await sb.from('mosaic_submission_saves')
    .select('created_at,mosaic_submissions(id,pixel_id,project_id,image_url,art_title,art_description,art_link,author_id,author_name,author_avatar_url)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) { console.error('load saved weavo art error:', error); return []; }
  return (data || []).map(row => row.mosaic_submissions).filter(Boolean);
}
function profileArtThumbEl(sub) {
  const el = document.createElement('div');
  el.className = 'profile-art-thumb';
  el.title = sub.art_title || '';
  const img = document.createElement('img'); img.src = sub.image_url; img.alt = '';
  el.appendChild(img);
  el.onclick = () => openLightbox(sub);
  return el;
}

// ---------- this profile's own network graph (Obsidian-style local graph of save relationships) ----------
let graphSim    = null;  // running d3-force simulation, so it can be stopped on navigation
let graphRootId = null;  // the profile this section was opened on, for the "Back" breadcrumb

function nodeRadius(d) { return d.isCenter ? 22 : 16; }
function stopGraph() {
  if (graphSim) { graphSim.stop(); graphSim = null; }
}
function resetProfileGraph(userId) {
  stopGraph();
  graphRootId = userId;
  document.getElementById('profileGraphSvg').innerHTML = '';
  document.getElementById('profileGraphCrumb').style.display = 'none';
  document.getElementById('profileGraphEmpty').style.display = 'none';
}
// Direct (1-hop) save relationships around `userId`: artists whose work
// they've saved (outgoing) and people who've saved their work (incoming).
// mosaic_submission_saves rows are public, so this works for any profile,
// not just the signed-in user's own.
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
      label: p.username || p.name || tr('anonymous'),
      avatar_url: p.avatar_url || '',
      direction: out && inn ? 'mutual' : (out ? 'out' : 'in'),
    };
  });
}
async function renderProfileGraphFor(centerId, isRoot) {
  const panel = document.getElementById('profileGraphPanel');
  const svgEl = document.getElementById('profileGraphSvg');
  const empty = document.getElementById('profileGraphEmpty');
  const crumb = document.getElementById('profileGraphCrumb');
  const crumbLabel = document.getElementById('profileGraphCrumbLabel');
  const crumbVisit = document.getElementById('profileGraphCrumbVisit');
  stopGraph();
  svgEl.innerHTML = '';

  const [{ data: centerProfile }, neighbors] = await Promise.all([
    sb.from('profiles').select('id,name,username,avatar_url').eq('id', centerId).maybeSingle(),
    fetchGraphNeighbors(centerId),
  ]);
  if (!centerProfile) return;

  const centerLabel = centerProfile.username || centerProfile.name || tr('anonymous');
  crumb.style.display = isRoot ? 'none' : 'flex';
  if (!isRoot) {
    crumbLabel.textContent = tr('viewingNetwork', { name: centerLabel });
    crumbVisit.onclick = (e) => { e.preventDefault(); location.href = profileUrl(centerId); };
  }
  document.getElementById('profileGraphBack').onclick = () => renderProfileGraphFor(graphRootId, true);

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
  // 'auto-start-reverse' (not plain 'auto') so a marker also renders
  // correctly at the *start* of a line — flipped 180° so it points
  // outward rather than back along the line — which is what a mutual
  // (both-directions) save relationship below needs on both ends.
  const arrow = (id, fill) => defs.append('marker').attr('id', id)
    .attr('viewBox', '0 -5 10 10').attr('refX', 24).attr('refY', 0)
    .attr('markerWidth', 6).attr('markerHeight', 6).attr('orient', 'auto-start-reverse')
    .append('path').attr('d', 'M0,-5L10,0L0,5').attr('fill', fill);
  arrow('pg-arrow-out', 'rgba(58,58,56,.35)');
  arrow('pg-arrow-in',  '#1A3C2B');

  const root = svg.append('g');
  svg.call(d3.zoom().scaleExtent([0.4, 2.5]).on('zoom', ev => root.attr('transform', ev.transform)));

  // 'out' (I saved them): single faint arrow pointing away from center.
  // 'in' (they saved me): single solid arrow pointing toward center.
  // 'mutual' (both): solid arrows on BOTH ends, so a two-way save
  // relationship is visually unmistakable rather than relying on the
  // thicker .pg-mutual line alone.
  const link = root.append('g').selectAll('line').data(links).join('line')
    .attr('class', d => 'pg-link' + (d.kind === 'mutual' ? ' pg-mutual' : ''))
    .attr('marker-end', d => `url(#${d.kind === 'in' || d.kind === 'mutual' ? 'pg-arrow-in' : 'pg-arrow-out'})`)
    .attr('marker-start', d => d.kind === 'mutual' ? 'url(#pg-arrow-in)' : null);

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

  function ticked() {
    link.attr('x1', d => d.source.x).attr('y1', d => d.source.y)
        .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
    node.attr('transform', d => `translate(${d.x},${d.y})`);
    label.attr('x', d => d.x).attr('y', d => d.y);
  }
  const sim = d3.forceSimulation(nodes)
    .force('link', d3.forceLink(links).id(d => d.id).distance(90).strength(0.6))
    .force('charge', d3.forceManyBody().strength(-260))
    .force('collide', d3.forceCollide(d => nodeRadius(d) + 14))
    .force('x', d3.forceX(width / 2).strength(0.05))
    .force('y', d3.forceY(height / 2).strength(0.05))
    .force('drift', driftForce(nodes))
    .alphaTarget(GRAPH_DRIFT_ALPHA_TARGET)
    .on('tick', ticked);
  // Paint real coordinates synchronously before the first frame: d3-force's
  // first tick fires on the next animation frame, so without this the
  // browser's very first paint sees all <line>s at their zero-length SVG
  // default (no x1/y1/x2/y2 yet). With auto-start-reverse markers, that
  // degenerate first paint leaves the arrowhead orientation stuck/invisible
  // on this <line> even after later ticks move it — which is why arrows
  // only showed up once a click forced the graph to re-render.
  ticked();
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
      if (!ev.active) sim.alphaTarget(GRAPH_DRIFT_ALPHA_TARGET);
      if (d.isCenter) { d.fx = width / 2; d.fy = height / 2; }
      else { d.fx = null; d.fy = null; }
    }));

  node.on('click', (ev, d) => {
    if (d.isCenter || dragMoved) return;
    ev.stopPropagation();
    renderProfileGraphFor(d.id, d.id === graphRootId);
  });
}

async function loadProfileView(userId) {
  profileUserId = userId;
  document.getElementById('profileName').textContent = tr('loading');
  document.getElementById('profileMeta').textContent = '';
  document.getElementById('profileLinksList').innerHTML = '';
  document.getElementById('profileAvatarWrap').innerHTML = '';
  document.getElementById('profileBio').style.display = 'none';
  document.getElementById('profileProjectsSection').style.display = 'none';
  document.getElementById('profileProjectsGrid').innerHTML = '';
  document.getElementById('profileSubmittedGrid').innerHTML = '';
  document.getElementById('profileSavedGrid').innerHTML = '';
  document.getElementById('profileSubmittedEmpty').style.display = 'none';
  document.getElementById('profileSavedEmpty').style.display = 'none';
  resetProfileGraph(userId);

  const [{ data: profile }, submitted, saved] = await Promise.all([
    sb.from('profiles').select('id,name,username,avatar_url,bio,links,country_id,created_at').eq('id', userId).maybeSingle(),
    fetchSubmittedWeavoArt(userId),
    fetchSavedWeavoArt(userId)
  ]);
  if (!profile) { document.getElementById('profileName').textContent = tr('userNotFound'); return; }
  const participatedProjects = await fetchParticipatedProjects(submitted, userId);

  const displayName = profile.username || profile.name || tr('anonymous');
  document.getElementById('profileName').textContent = displayName;
  const avatarWrap = document.getElementById('profileAvatarWrap');
  if (profile.avatar_url) {
    const img = document.createElement('img'); img.className = 'profile-avatar-lg'; img.src = profile.avatar_url; img.alt = '';
    avatarWrap.appendChild(img);
  } else {
    const fb = document.createElement('div'); fb.className = 'profile-avatar-fallback-lg';
    fb.textContent = displayName.charAt(0).toUpperCase();
    avatarWrap.appendChild(fb);
  }
  const joinedText = fmtJoined(profile.created_at);
  const countryLabel = profile.country_id && countryName(profile.country_id);
  document.getElementById('profileMeta').textContent = countryLabel ? `${joinedText} · ${countryLabel}` : joinedText;
  const bioEl = document.getElementById('profileBio');
  if (profile.bio) { bioEl.textContent = profile.bio; bioEl.style.display = ''; }
  const linksEl = document.getElementById('profileLinksList');
  for (const { key, label } of LINK_PLATFORMS) {
    const url = profile.links && profile.links[key];
    const href = url ? safeHref(url) : null;
    if (!href) continue;
    const a = document.createElement('a');
    a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer';
    a.className = 'profile-link-chip'; a.textContent = label;
    linksEl.appendChild(a);
  }

  if (participatedProjects.length) {
    const projectsGrid = document.getElementById('profileProjectsGrid');
    for (const project of participatedProjects) projectsGrid.appendChild(profileProjectCardEl(project));
    document.getElementById('profileProjectsSection').style.display = '';
  }

  const submittedGrid = document.getElementById('profileSubmittedGrid');
  if (!submitted.length) document.getElementById('profileSubmittedEmpty').style.display = '';
  else for (const sub of submitted) submittedGrid.appendChild(profileArtThumbEl(sub));

  const savedGrid = document.getElementById('profileSavedGrid');
  if (!saved.length) document.getElementById('profileSavedEmpty').style.display = '';
  else for (const sub of saved) savedGrid.appendChild(profileArtThumbEl(sub));

  const editBtn = document.getElementById('profileEditBtn');
  editBtn.style.display = (me.id && me.id === userId) ? '' : 'none';
  editBtn.onclick = () => openEditProfileModal(profile);

  renderProfileGraphFor(userId, true);
}

window.onSubmissionDeleted = () => { if (profileUserId) loadProfileView(profileUserId); };
window.onProfileSaved = () => { if (profileUserId) loadProfileView(profileUserId); };

authReady.then(async () => {
  const requested = new URLSearchParams(location.search).get('user');
  const userId = requested || me.id;
  if (!userId) { document.getElementById('profileName').textContent = tr('userNotFound'); return; }
  await loadProfileView(userId);
});
