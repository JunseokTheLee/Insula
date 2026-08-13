// Profile page: header, contributed/submitted/liked artwork, and this
// user's own save-relationship graph. Reads the profile's user id from
// ?user= (falls back to the signed-in user once auth resolves, if none
// given). Needs common.js, auth.js, lightbox.js and js/graph-common.js.
"use strict";

function openProject(id) { location.href = projectUrl(id); }

let profileUserId = null;

// Client-side fallback for the tab title/social-preview tags, in case this
// page is reached without going through the Pages Function that pre-renders
// them server-side (see functions/[lang]/artists/[handle].js).
function updateProfileMeta(profile, displayName) {
  const title = `${displayName} | Weavo`;
  const description = profile.bio
    ? profile.bio.slice(0, 300)
    : (CURRENT_LANG === 'ko' ? `Weavo의 작가 ${displayName}님의 프로필입니다.` : `${displayName}'s artist profile on Weavo.`);
  updatePageMeta({ title, description, canonical: `${location.origin}${profileUrl(profile.username || profile.id)}`, image: profile.avatar_url });
}
function renderProfileJsonLd(profile, displayName) {
  const url = `${location.origin}${profileUrl(profile.username || profile.id)}`;
  const data = { '@context': 'https://schema.org', '@type': 'Person', name: displayName, url };
  if (profile.avatar_url) data.image = profile.avatar_url;
  if (profile.bio) data.description = profile.bio;
  // No standalone "/artists" listing page exists in this app (artists are
  // discovered through project/artwork pages, not a directory) — a
  // two-level Home > {name} breadcrumb reflects the real navigable
  // hierarchy, rather than inventing an intermediate crumb that goes nowhere.
  const breadcrumb = {
    '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Weavo', item: `${location.origin}/${CURRENT_LANG}/` },
      { '@type': 'ListItem', position: 2, name: displayName, item: url },
    ],
  };
  injectJsonLd([data, breadcrumb]);
}

document.getElementById('profileBackBtn').addEventListener('click', e => {
  e.preventDefault();
  stopGraph();
  const sameOriginReferrer = document.referrer && (() => {
    try { return new URL(document.referrer).origin === location.origin; } catch { return false; }
  })();
  if (sameOriginReferrer) history.back();
  else location.href = `/${CURRENT_LANG}/projects`;
});

// Every piece this profile's owner has posted, whether or not it's made it
// into a project yet — like a social feed, all of it lives on the profile;
// profileArtThumbEl's `pending` flag (driven by a null project_id) is what
// marks the ones still waiting for a match.
async function fetchUserArtwork(userId) {
  const { data, error } = await sb.from('mosaic_submissions')
    .select('id,pixel_id,project_id,image_url,thumb_url,art_title,art_material,art_completed_date,art_description,art_link,author_id,author_name,author_avatar_url,created_at')
    .eq('author_id', userId)
    .order('created_at', { ascending: false });
  if (error) { console.error('load user artwork error:', error); return []; }
  return data || [];
}
// Distinct projects this profile's owner has contributed artwork to, with
// how many pieces they submitted to each.
//
// A project can be reshaped (admin swaps its grid + reference image),
// which freezes the pre-reshape grid as its own archived project row
// (supabase_mosaic_reshape.sql) instead of deleting it. `artwork` always
// carries each submission's *live* project_id (reshape repoints pixel_id,
// never project_id), so that alone only ever surfaces the current project.
// This additionally looks up, via mosaic_pixels, every archived project
// whose frozen grid still shows one of this user's pieces — one card per
// iteration they were actually part of.
async function fetchParticipatedProjects(artwork, userId) {
  const result = [];
  const placedIds = [...new Set(artwork.map(s => s.project_id).filter(id => id != null))];
  if (placedIds.length) {
    const { data, error } = await sb.from('mosaic_projects')
      .select('id,title,reference_image_url')
      .in('id', placedIds);
    if (error) console.error('load participated (live) projects error:', error);
    if (data) {
      const projectById = new Map(data.map(p => [p.id, p]));
      const byProject = new Map();
      for (const sub of artwork) {
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
  const card = document.createElement('a');
  card.className = 'pv-card';
  card.href = projectUrl(project.id);
  const thumb = document.createElement('div');
  thumb.className = 'pv-card-thumb';
  const img = document.createElement('img');
  img.src = cdnUrl(project.reference_image_url);
  img.alt = project.title ? tr('projectPreviewAlt', { title: project.title }) : '';
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
// ---------- collections (named boards built from the Liked pool) ----------
// Items are embedded per collection (rather than fetched separately) so a
// collection's cover thumb and item count are both derivable client-side
// without an extra round trip, and so the add-to-collection picker already
// knows which boards a given piece is already on.
let profileCollections = [];
async function fetchUserCollections(userId) {
  const { data, error } = await sb.from('mosaic_collections')
    .select('id,title,description,is_public,created_at,mosaic_collection_items(submission_id,added_at,mosaic_submissions(thumb_url,image_url))')
    .eq('owner_id', userId)
    .order('created_at', { ascending: false });
  if (error) { console.error('load collections error:', error); toast(tr('couldNotLoadCollections')); return []; }
  return data || [];
}
function collectionCoverUrl(collection) {
  const items = collection.mosaic_collection_items || [];
  if (!items.length) return null;
  const latest = items.reduce((a, b) => (new Date(a.added_at) > new Date(b.added_at) ? a : b));
  const sub = latest.mosaic_submissions;
  return sub ? cdnUrl(sub.thumb_url || sub.image_url) : null;
}
function collectionCardEl(collection, isOwner) {
  const card = document.createElement('a');
  card.className = 'pv-card';
  card.href = collectionUrl(collection.id);
  const thumb = document.createElement('div');
  thumb.className = 'pv-card-thumb';
  const coverUrl = collectionCoverUrl(collection);
  if (coverUrl) {
    const img = document.createElement('img');
    img.src = coverUrl;
    img.alt = tr('collectionCoverAlt', { title: collection.title });
    thumb.appendChild(img);
  }
  card.appendChild(thumb);
  const info = document.createElement('div');
  info.className = 'pv-card-info';
  const title = document.createElement('div');
  title.className = 'pv-card-title'; title.textContent = collection.title;
  if (isOwner && !collection.is_public) {
    const badge = document.createElement('span');
    badge.className = 'pv-card-archived-badge';
    badge.textContent = tr('privateBadge');
    title.appendChild(document.createTextNode(' '));
    title.appendChild(badge);
  }
  const count = document.createElement('div');
  count.className = 'pv-card-author';
  count.textContent = collectionItemCountText((collection.mosaic_collection_items || []).length);
  info.append(title, count);
  card.appendChild(info);
  return card;
}
function renderCollectionsSection(collections, isOwner) {
  profileCollections = collections;
  const section = document.getElementById('profileCollectionsSection');
  const grid = document.getElementById('profileCollectionsGrid');
  grid.innerHTML = '';
  document.getElementById('newCollectionBtn').style.display = isOwner ? '' : 'none';
  section.style.display = (isOwner || collections.length) ? '' : 'none';
  document.getElementById('profileCollectionsEmpty').style.display = collections.length ? 'none' : '';
  for (const c of collections) grid.appendChild(collectionCardEl(c, isOwner));
}
async function refreshCollectionsSection() {
  if (!profileUserId) return;
  renderCollectionsSection(await fetchUserCollections(profileUserId), me.id === profileUserId);
}

// ---------- new collection modal ----------
function openNewCollectionModal() {
  document.getElementById('nc-title').value = '';
  document.getElementById('nc-desc').value = '';
  document.getElementById('nc-public').checked = true;
  document.getElementById('nc-error').textContent = '';
  document.getElementById('new-collection-modal').classList.add('open');
}
document.getElementById('newCollectionBtn').onclick = () => { if (!me.id) { openAuthModal(); return; } openNewCollectionModal(); };
document.getElementById('nc-cancel').onclick = () => document.getElementById('new-collection-modal').classList.remove('open');
document.getElementById('new-collection-modal').addEventListener('click', e => { if (e.target === e.currentTarget) e.currentTarget.classList.remove('open'); });
document.getElementById('nc-submit').onclick = async () => {
  const title = document.getElementById('nc-title').value.trim();
  const errorEl = document.getElementById('nc-error');
  if (!title) { errorEl.textContent = tr('titleRequired'); return; }
  errorEl.textContent = '';
  const btn = document.getElementById('nc-submit');
  btn.disabled = true;
  const { error } = await sb.from('mosaic_collections').insert({
    owner_id: me.id, title,
    description: document.getElementById('nc-desc').value.trim() || null,
    is_public: document.getElementById('nc-public').checked,
  });
  btn.disabled = false;
  if (error) { console.error('create collection error:', error); errorEl.textContent = tr('couldNotCreateCollectionMsg', { msg: error.message }); return; }
  document.getElementById('new-collection-modal').classList.remove('open');
  toast(tr('collectionCreatedToast'));
  refreshCollectionsSection();
};

// ---------- add-to-collection picker ----------
let atcSubmission = null;
function atcRowEl(collection) {
  const row = document.createElement('label');
  row.className = 'saves-list-row';
  row.style.cursor = 'pointer';
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox'; checkbox.style.width = 'auto';
  const items = collection.mosaic_collection_items || [];
  checkbox.checked = items.some(i => i.submission_id === atcSubmission.id);
  checkbox.onchange = async () => {
    checkbox.disabled = true;
    const { error } = checkbox.checked
      ? await sb.from('mosaic_collection_items').insert({ collection_id: collection.id, submission_id: atcSubmission.id })
      : await sb.from('mosaic_collection_items').delete().eq('collection_id', collection.id).eq('submission_id', atcSubmission.id);
    checkbox.disabled = false;
    if (error) { console.error('update collection item error:', error); toast(tr('couldNotUpdateCollection')); checkbox.checked = !checkbox.checked; return; }
    if (checkbox.checked) items.push({ submission_id: atcSubmission.id, added_at: new Date().toISOString(), mosaic_submissions: atcSubmission });
    else { const idx = items.findIndex(i => i.submission_id === atcSubmission.id); if (idx !== -1) items.splice(idx, 1); }
  };
  const name = document.createElement('span'); name.className = 'saves-list-name'; name.textContent = collection.title;
  row.append(checkbox, name);
  return row;
}
function openAddToCollectionModal(sub) {
  atcSubmission = sub;
  const list = document.getElementById('atc-list');
  list.innerHTML = '';
  document.getElementById('atc-empty').style.display = profileCollections.length ? 'none' : '';
  for (const c of profileCollections) list.appendChild(atcRowEl(c));
  document.getElementById('add-to-collection-modal').classList.add('open');
}
document.getElementById('atc-new').onclick = () => {
  document.getElementById('add-to-collection-modal').classList.remove('open');
  openNewCollectionModal();
};
function closeAddToCollectionModal() {
  document.getElementById('add-to-collection-modal').classList.remove('open');
  refreshCollectionsSection();
}
document.getElementById('atc-done').onclick = closeAddToCollectionModal;
document.getElementById('add-to-collection-modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeAddToCollectionModal(); });

// `showBoardBtn` is passed for the owner's own Submitted and Liked grids —
// an overlay button that opens the add-to-collection picker for that piece,
// without triggering the thumb's own click-to-lightbox behavior.
function profileArtThumbEl(sub, pending, showBoardBtn) {
  const el = document.createElement('a');
  el.className = 'profile-art-thumb';
  el.href = artworkUrl(sub.id);
  el.title = sub.art_title || '';
  const img = document.createElement('img');
  img.src = cdnUrl(sub.thumb_url || sub.image_url);
  img.alt = sub.art_title ? tr('artworkThumbAlt', { title: sub.art_title, name: sub.author_name || tr('anonymous') }) : '';
  el.appendChild(img);
  if (pending) {
    const badge = document.createElement('span');
    badge.className = 'pool-badge';
    badge.textContent = tr('waitingForMatchBadge');
    el.appendChild(badge);
  }
  if (showBoardBtn) {
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'board-add-btn'; btn.textContent = '+';
    btn.setAttribute('aria-label', tr('addToCollectionLabel'));
    btn.onclick = e => { e.preventDefault(); e.stopPropagation(); openAddToCollectionModal(sub); };
    el.appendChild(btn);
  }
  interceptClick(el, () => openLightbox(sub));
  return el;
}

// ---------- this profile's saves list modal ----------
// fetchSaveCounts/fetchIsSaving/toggleUserSave live in common.js (shared
// with the lightbox's own artist save button — see setupLightboxArtistSave
// in lightbox.js) — only the list-modal bits, specific to this page's UI,
// stay here.
// direction: 'saves' = people userId saves (their outgoing list), 'savedBy' = people who save userId (their followers)
async function fetchUserSaveList(userId, direction) {
  const col = direction === 'saves' ? 'saver_id' : 'saved_id';
  const otherCol = direction === 'saves' ? 'saved_id' : 'saver_id';
  const { data: rows, error } = await sb.from('user_saves').select(otherCol).eq(col, userId);
  if (error) { console.error('load save list error:', error); return []; }
  const ids = [...new Set((rows || []).map(r => r[otherCol]))];
  if (!ids.length) return [];
  const { data: profiles, error: profErr } = await sb.from('profiles')
    .select('id,name,username,avatar_url').in('id', ids);
  if (profErr) { console.error('load save list profiles error:', profErr); return []; }
  return profiles || [];
}
function saveListRowEl(p) {
  const row = document.createElement('a');
  row.className = 'saves-list-row';
  row.href = profileUrl(p.username || p.id);
  const name = p.username || p.name || tr('anonymous');
  if (p.avatar_url) {
    const img = document.createElement('img');
    img.className = 'saves-list-avatar'; img.src = cdnUrl(p.avatar_url);
    img.alt = tr('artistAvatarAlt', { name });
    row.appendChild(img);
  } else {
    const fb = document.createElement('div');
    fb.className = 'saves-list-avatar-fallback';
    fb.textContent = name.charAt(0).toUpperCase();
    row.appendChild(fb);
  }
  const nameEl = document.createElement('span');
  nameEl.className = 'saves-list-name'; nameEl.textContent = name;
  row.appendChild(nameEl);
  return row;
}
let savesListToken = 0;
async function openSavesListModal(userId, direction) {
  const token = ++savesListToken;
  const modal = document.getElementById('saves-list-modal');
  const title = document.getElementById('saves-list-title');
  const content = document.getElementById('saves-list-content');
  const empty = document.getElementById('saves-list-empty');
  title.textContent = tr(direction === 'saves' ? 'savesListTitle' : 'savedByListTitle');
  content.innerHTML = '';
  empty.style.display = 'none';
  modal.classList.add('open');
  const list = await fetchUserSaveList(userId, direction);
  if (token !== savesListToken) return; // a newer open superseded this one
  if (!list.length) { empty.style.display = ''; return; }
  for (const p of list) content.appendChild(saveListRowEl(p));
}
document.getElementById('saves-list-modal').addEventListener('click', e => {
  if (e.target === e.currentTarget) e.currentTarget.classList.remove('open');
});

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
// Direct (1-hop) save relationships around `userId`: people they save
// (outgoing) and people who save them (incoming). user_saves rows are
// public, so this works for any profile, not just the signed-in user's own.
async function fetchGraphNeighbors(userId) {
  const [{ data: outRows, error: outErr }, { data: inRows, error: inErr }] = await Promise.all([
    sb.from('user_saves').select('saved_id').eq('saver_id', userId),
    sb.from('user_saves').select('saver_id').eq('saved_id', userId),
  ]);
  if (outErr) console.error('load graph (outgoing) error:', outErr);
  if (inErr)  console.error('load graph (incoming) error:', inErr);

  const outIds = new Set(); // people userId saves
  for (const row of (outRows || [])) {
    if (row.saved_id && row.saved_id !== userId) outIds.add(row.saved_id);
  }
  const inIds = new Set(); // people who save userId
  for (const row of (inRows || [])) {
    if (row.saver_id && row.saver_id !== userId) inIds.add(row.saver_id);
  }

  const ids = new Set([...outIds, ...inIds]);
  if (!ids.size) return [];

  const { data: profiles, error: profErr } = await sb.from('profiles')
    .select('id,name,username,avatar_url').in('id', [...ids]);
  if (profErr) console.error('load graph profiles error:', profErr);
  const profileById = new Map((profiles || []).map(p => [p.id, p]));

  return [...ids].map(id => {
    const p = profileById.get(id) || {};
    const out = outIds.has(id), inn = inIds.has(id);
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
    crumbVisit.href = profileUrl(centerId);
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
      g.append('image').attr('href', cdnUrl(d.avatar_url))
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
  document.getElementById('profileLikedGrid').innerHTML = '';
  document.getElementById('profileCollectionsGrid').innerHTML = '';
  document.getElementById('profileCollectionsSection').style.display = 'none';
  document.getElementById('profileSubmittedEmpty').style.display = 'none';
  document.getElementById('profileLikedEmpty').style.display = 'none';
  document.getElementById('profileSaveCounts').style.display = 'none';
  document.getElementById('profileSaveBtn').style.display = 'none';
  resetProfileGraph(userId);

  const isOwner = me.id && me.id === userId;
  const [{ data: profile }, artwork, liked, collections, saveCounts, isSaving] = await Promise.all([
    sb.from('profiles').select('id,name,username,avatar_url,bio,links,country_id,created_at').eq('id', userId).maybeSingle(),
    fetchUserArtwork(userId),
    fetchLikedWeavoArt(userId),
    fetchUserCollections(userId),
    fetchSaveCounts(userId),
    (me.id && !isOwner) ? fetchIsSaving(me.id, userId) : Promise.resolve(false),
  ]);
  if (!profile) { document.getElementById('profileName').textContent = tr('userNotFound'); return; }
  // Canonicalize the address bar to /artists/{username} once a username is
  // known — inbound links built from a raw author_id (miniAvatarEl, comment
  // bylines, etc.) still work via the id fallback in resolveProfileHandle(),
  // but the shareable URL this page settles on should be the vanity one.
  if (profile.username) history.replaceState(null, '', profileUrl(profile.username));
  const participatedProjects = await fetchParticipatedProjects(artwork, userId);

  const displayName = profile.username || profile.name || tr('anonymous');
  document.getElementById('profileName').textContent = displayName;
  updateProfileMeta(profile, displayName);
  renderProfileJsonLd(profile, displayName);
  const avatarWrap = document.getElementById('profileAvatarWrap');
  if (profile.avatar_url) {
    const img = document.createElement('img'); img.className = 'profile-avatar-lg'; img.src = cdnUrl(profile.avatar_url);
    img.alt = tr('artistAvatarAlt', { name: displayName });
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
    a.href = href; a.target = '_blank'; a.rel = 'ugc nofollow noopener noreferrer';
    a.className = 'profile-link-chip'; a.textContent = label;
    linksEl.appendChild(a);
  }

  if (participatedProjects.length) {
    const projectsGrid = document.getElementById('profileProjectsGrid');
    for (const project of participatedProjects) projectsGrid.appendChild(profileProjectCardEl(project));
    document.getElementById('profileProjectsSection').style.display = '';
  }

  const submittedGrid = document.getElementById('profileSubmittedGrid');
  if (!artwork.length) document.getElementById('profileSubmittedEmpty').style.display = '';
  // showBoardBtn here too (not just the Liked grid below) so an owner's own
  // artwork is always addable to a collection, whether or not they've liked it.
  else for (const sub of artwork) submittedGrid.appendChild(profileArtThumbEl(sub, !sub.project_id, isOwner));

  const likedGrid = document.getElementById('profileLikedGrid');
  if (!liked.length) document.getElementById('profileLikedEmpty').style.display = '';
  else for (const sub of liked) likedGrid.appendChild(profileArtThumbEl(sub, false, isOwner));

  renderCollectionsSection(collections, isOwner);

  const editBtn = document.getElementById('profileEditBtn');
  editBtn.style.display = isOwner ? '' : 'none';
  editBtn.onclick = () => openEditProfileModal(profile);

  const uploadBtn = document.getElementById('profileUploadBtn');
  uploadBtn.style.display = isOwner ? '' : 'none';

  const saveBtn = document.getElementById('profileSaveBtn');
  saveBtn.style.display = isOwner ? 'none' : '';
  if (!isOwner) {
    saveBtn.classList.toggle('saving', isSaving);
    saveBtn.textContent = isSaving ? tr('savingLabel') : tr('saveLabel');
    saveBtn.onclick = () => toggleUserSave(userId, saveBtn);
  }
  document.getElementById('profileSavesN').textContent = saveCounts.saves;
  document.getElementById('profileSavedByN').textContent = saveCounts.savedBy;
  document.getElementById('profileSaveCounts').style.display = '';
  document.getElementById('profileSavesCount').onclick = () => openSavesListModal(userId, 'saves');
  document.getElementById('profileSavedByCount').onclick = () => openSavesListModal(userId, 'savedBy');

  renderProfileGraphFor(userId, true);
}

// ---------- upload artwork (to the profile pool — not directly into a project) ----------
// Placement happens separately: runPoolMatching() (js/matching.js) is
// called right after the insert below and greedily matches every unmatched
// pool piece (this one included) against open cells across every active
// project, same as it's triggered after project creation/reshape/removal.
const artPicker = setupPicker('art-picker');
document.getElementById('profileUploadBtn').onclick = () => {
  if (!me.id) { openAuthModal(); return; }
  artPicker.reset();
  document.getElementById('ua-title').value = '';
  document.getElementById('ua-material').value = '';
  // Can't complete a piece in the future — same bound as the DB's
  // mosaic_submissions_art_completed_date_range check constraint.
  document.getElementById('ua-completed').max = new Date().toISOString().slice(0, 10);
  document.getElementById('ua-completed').value = '';
  document.getElementById('ua-desc').value = '';
  document.getElementById('ua-link').value = '';
  document.getElementById('ua-error').textContent = '';
  document.getElementById('upload-art-modal').classList.add('open');
};
function closeUploadArtModal() { document.getElementById('upload-art-modal').classList.remove('open'); }
document.getElementById('ua-cancel').onclick = closeUploadArtModal;
document.getElementById('upload-art-modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeUploadArtModal(); });
document.getElementById('ua-submit').onclick = async () => {
  const file = artPicker.getFile();
  const errorEl = document.getElementById('ua-error');
  if (!file) { errorEl.textContent = tr('addImageFirst'); return; }
  const link = document.getElementById('ua-link').value.trim();
  if (link && !safeHref(link)) { errorEl.textContent = tr('linkMustBeValidUrl'); return; }
  errorEl.textContent = '';
  const meta = {
    title: document.getElementById('ua-title').value.trim(),
    material: document.getElementById('ua-material').value.trim(),
    completedDate: document.getElementById('ua-completed').value || null,
    description: document.getElementById('ua-desc').value.trim(),
    link
  };
  const btn = document.getElementById('ua-submit');
  btn.disabled = true;
  toast(tr('uploadingToast'));
  try {
    const previewImg = await loadImageEl(artPicker.getPreviewEl().src);
    const avg = imageAverageColor(previewImg);
    const uploaded = await uploadArtworkImage(file);
    if (!uploaded.url) return;

    const { data: inserted, error: insErr } = await sb.from('mosaic_submissions').insert({
      author_id: me.id, author_name: me.username || me.name || null, author_avatar_url: me.avatar || null,
      image_url: uploaded.url, thumb_url: uploaded.thumbUrl,
      avg_r: avg.r, avg_g: avg.g, avg_b: avg.b,
      art_title: meta.title || null, art_material: meta.material || null, art_completed_date: meta.completedDate,
      art_description: meta.description || null, art_link: meta.link || null
    }).select('id').single();
    if (insErr || !inserted) {
      console.error('profile artwork insert error:', insErr);
      toast(insErr && insErr.code === 'RATE1' ? tr('uploadRateLimited') : tr('couldNotSubmitRetry'));
      return;
    }

    closeUploadArtModal();
    toast(tr('findingBestSpot'));
    const assignments = await runPoolMatching();
    const matched = assignments.some(a => a.submission_id === inserted.id);
    toast(matched ? tr('artworkMatchedToast') : tr('artworkPooledToast'));
  } finally {
    btn.disabled = false;
    if (profileUserId) loadProfileView(profileUserId);
  }
};

window.onSubmissionDeleted = () => { if (profileUserId) loadProfileView(profileUserId); };
window.onProfileSaved = () => { if (profileUserId) loadProfileView(profileUserId); };

// The /artists/{handle} route accepts either a real user id (links built
// from a submission/comment's author_id) or a username slug (the profile's
// own canonical URL) — try it as a username first (case-insensitive, matches
// the profiles_username_key unique index), then fall back to treating it as
// a raw id so pre-username links keep resolving.
async function resolveProfileHandle(handle) {
  const { data } = await sb.from('profiles').select('id').ilike('username', handle).maybeSingle();
  return (data && data.id) || handle;
}

authReady.then(async () => {
  const requested = routeParam('artists', 'user');
  const handle = requested || me.id;
  if (!handle) { document.getElementById('profileName').textContent = tr('userNotFound'); return; }
  const userId = await resolveProfileHandle(handle);
  await loadProfileView(userId);
});
