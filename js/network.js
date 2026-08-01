// Sitewide network page: every user, mapped by save relationships.
// Needs js/graph-common.js for driftForce/truncateLabel.
"use strict";

let globalGraphSim = null;
let globalGraphToken = 0; // guards against a stale fetch finishing after a newer one started
let globalZoomBehavior = null; // set whenever the graph has nodes, so the toolbar buttons have something to drive
function stopGlobalGraph() {
  if (globalGraphSim) { globalGraphSim.stop(); globalGraphSim = null; }
}
const GLOBAL_GRAPH_ZOOM_STEP = 1.4;
document.getElementById('globalGraph-zoom-in').onclick = () => {
  if (!globalZoomBehavior) return;
  d3.select('#globalGraphSvg').transition().duration(150).call(globalZoomBehavior.scaleBy, GLOBAL_GRAPH_ZOOM_STEP);
};
document.getElementById('globalGraph-zoom-out').onclick = () => {
  if (!globalZoomBehavior) return;
  d3.select('#globalGraphSvg').transition().duration(150).call(globalZoomBehavior.scaleBy, 1 / GLOBAL_GRAPH_ZOOM_STEP);
};
document.getElementById('globalGraph-zoom-reset').onclick = () => {
  if (!globalZoomBehavior) return;
  d3.select('#globalGraphSvg').transition().duration(200).call(globalZoomBehavior.transform, d3.zoomIdentity);
};
function globalNodeRadius(d) { return Math.max(9, Math.min(24, 9 + Math.sqrt(d.degree || 1) * 3.2)); }
// Every save across the whole app, collapsed into an undirected pair per
// two users with a direction flag each way, so A-saved-B and B-saved-A
// (independent facts, same as the per-profile graph) render as one mutual
// link instead of two overlapping ones.
async function fetchGlobalGraphData() {
  const { data: rows, error } = await sb.from('mosaic_submission_saves')
    .select('user_id,mosaic_submissions!inner(author_id)');
  if (error) { console.error('load global network error:', error); return { nodes: [], links: [] }; }

  const pairs = new Map(); // "smallerId|largerId" -> {a,b,aToB,bToA}
  for (const row of (rows || [])) {
    const saverId = row.user_id;
    const authorId = row.mosaic_submissions && row.mosaic_submissions.author_id;
    if (!saverId || !authorId || saverId === authorId) continue;
    const [a, b] = saverId < authorId ? [saverId, authorId] : [authorId, saverId];
    let p = pairs.get(`${a}|${b}`);
    if (!p) { p = { a, b, aToB: false, bToA: false }; pairs.set(`${a}|${b}`, p); }
    if (saverId === a) p.aToB = true; else p.bToA = true;
  }
  if (!pairs.size) return { nodes: [], links: [] };

  const degree = new Map();
  for (const p of pairs.values()) {
    degree.set(p.a, (degree.get(p.a) || 0) + 1);
    degree.set(p.b, (degree.get(p.b) || 0) + 1);
  }

  const { data: profiles, error: profErr } = await sb.from('profiles')
    .select('id,name,username,avatar_url').in('id', [...degree.keys()]);
  if (profErr) console.error('load global network profiles error:', profErr);
  const profileById = new Map((profiles || []).map(p => [p.id, p]));

  const nodes = [...degree.keys()].map(id => {
    const p = profileById.get(id) || {};
    return { id, label: p.username || p.name || tr('anonymous'), avatar_url: p.avatar_url || '', degree: degree.get(id) };
  });
  const links = [...pairs.values()].map(p => ({
    source: p.aToB ? p.a : p.b,
    target: p.aToB ? p.b : p.a,
    kind: (p.aToB && p.bToA) ? 'mutual' : 'out',
  }));
  return { nodes, links };
}
async function loadGlobalNetwork() {
  const token = ++globalGraphToken;
  const panel = document.getElementById('globalGraphPanel');
  const svgEl = document.getElementById('globalGraphSvg');
  const empty = document.getElementById('globalGraphEmpty');
  const zoomToolbar = document.getElementById('globalGraphZoomToolbar');
  const zoomLevelEl = document.getElementById('globalGraph-zoom-level');
  stopGlobalGraph();
  svgEl.innerHTML = '';
  empty.style.display = 'none';
  zoomToolbar.style.display = 'none';
  zoomLevelEl.textContent = '100%';
  globalZoomBehavior = null;

  const { nodes, links } = await fetchGlobalGraphData();
  if (token !== globalGraphToken) return; // a newer load superseded this one

  empty.style.display = nodes.length ? 'none' : 'flex';
  if (!nodes.length) return;

  const width  = panel.clientWidth  || 900;
  const height = panel.clientHeight || 500;

  const svg = d3.select(svgEl).attr('viewBox', `0 0 ${width} ${height}`);
  const defs = svg.append('defs');
  const arrow = (id, fill) => defs.append('marker').attr('id', id)
    .attr('viewBox', '0 -5 10 10').attr('refX', 24).attr('refY', 0)
    .attr('markerWidth', 6).attr('markerHeight', 6).attr('orient', 'auto-start-reverse')
    .append('path').attr('d', 'M0,-5L10,0L0,5').attr('fill', fill);
  arrow('gg-arrow-out', 'rgba(247,247,245,.4)');
  arrow('gg-arrow-in',  '#9EFFBF');

  const root = svg.append('g');
  const zoomBehavior = d3.zoom().scaleExtent([0.25, 3]).on('zoom', ev => {
    root.attr('transform', ev.transform);
    zoomLevelEl.textContent = Math.round(ev.transform.k * 100) + '%';
  });
  svg.call(zoomBehavior);
  globalZoomBehavior = zoomBehavior;
  zoomToolbar.style.display = 'flex';

  const link = root.append('g').selectAll('line').data(links).join('line')
    .attr('class', d => 'pg-link' + (d.kind === 'mutual' ? ' pg-mutual' : ''))
    .attr('marker-end', d => `url(#${d.kind === 'mutual' ? 'gg-arrow-in' : 'gg-arrow-out'})`)
    .attr('marker-start', d => d.kind === 'mutual' ? 'url(#gg-arrow-in)' : null);

  const node = root.append('g').selectAll('g').data(nodes).join('g').attr('class', 'pg-node');

  node.each(function (d) {
    const g = d3.select(this);
    const r = globalNodeRadius(d);
    if (d.avatar_url) {
      const clipId = 'gg-clip-' + d.id;
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
    .attr('dy', d => globalNodeRadius(d) + 12);

  function ticked() {
    link.attr('x1', d => d.source.x).attr('y1', d => d.source.y)
        .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
    node.attr('transform', d => `translate(${d.x},${d.y})`);
    label.attr('x', d => d.x).attr('y', d => d.y);
  }
  const sim = d3.forceSimulation(nodes)
    .force('link', d3.forceLink(links).id(d => d.id).distance(90).strength(0.5))
    .force('charge', d3.forceManyBody().strength(-220))
    .force('collide', d3.forceCollide(d => globalNodeRadius(d) + 12))
    .force('x', d3.forceX(width / 2).strength(0.03))
    .force('y', d3.forceY(height / 2).strength(0.03))
    .force('drift', driftForce(nodes))
    .alphaTarget(GRAPH_DRIFT_ALPHA_TARGET)
    .on('tick', ticked);
  // See the matching comment in profile-view.js's renderProfileGraphFor:
  // paints real coordinates before the first paint so arrowheads aren't
  // stuck orientation-less on that initial zero-length-line frame.
  ticked();
  globalGraphSim = sim;

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
      d.fx = null; d.fy = null;
    }));

  node.on('click', (ev, d) => {
    if (dragMoved) return;
    ev.stopPropagation();
    location.href = profileUrl(d.id);
  });
}

authReady.then(() => loadGlobalNetwork());
