// Sitewide network page: every user, mapped by save relationships.
// Needs js/graph-common.js for truncateLabel.
"use strict";

let globalGraphSim = null;
let globalGraphToken = 0; // guards against a stale fetch finishing after a newer one started
let globalZoomBehavior = null; // set whenever the graph has nodes, so the toolbar buttons have something to drive
let globalFitAllView = null; // set alongside globalZoomBehavior — what the reset button calls
let globalRotationTimer = null;
function stopGlobalGraph() {
  if (globalGraphSim) { globalGraphSim.stop(); globalGraphSim = null; }
  if (globalRotationTimer) { globalRotationTimer.stop(); globalRotationTimer = null; }
}
// Stashed right before navigating to a profile from a node click below, and
// consumed on the next load of this page (see loadGlobalNetwork) — lets the
// profile page's "Back" button return here with that same person's local
// network still selected/zoomed instead of the fully-zoomed-out default.
const NETWORK_SELECTION_KEY = 'weavoNetworkSelectedId';
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
  if (!globalFitAllView) return;
  globalFitAllView();
};
function globalNodeRadius(d) { return Math.max(9, Math.min(24, 9 + Math.sqrt(d.degree || 1) * 3.2)); }
// Every save across the whole app, collapsed into an undirected pair per
// two users with a direction flag each way, so A-saved-B and B-saved-A
// (independent facts, same as the per-profile graph) render as one mutual
// link instead of two overlapping ones.
async function fetchGlobalGraphData() {
  const [{ data: rows, error }, { data: profiles, error: profErr }] = await Promise.all([
    sb.from('user_saves').select('saver_id,saved_id'),
    sb.from('profiles').select('id,name,username,avatar_url'),
  ]);
  if (error) { console.error('load global network error:', error); return { nodes: [], links: [] }; }
  if (profErr) { console.error('load global network profiles error:', profErr); return { nodes: [], links: [] }; }
  if (!profiles || !profiles.length) return { nodes: [], links: [] };

  const pairs = new Map(); // "smallerId|largerId" -> {a,b,aToB,bToA}
  for (const row of (rows || [])) {
    const saverId = row.saver_id, savedId = row.saved_id;
    if (!saverId || !savedId || saverId === savedId) continue;
    const [a, b] = saverId < savedId ? [saverId, savedId] : [savedId, saverId];
    let p = pairs.get(`${a}|${b}`);
    if (!p) { p = { a, b, aToB: false, bToA: false }; pairs.set(`${a}|${b}`, p); }
    if (saverId === a) p.aToB = true; else p.bToA = true;
  }

  const degree = new Map();
  for (const p of pairs.values()) {
    degree.set(p.a, (degree.get(p.a) || 0) + 1);
    degree.set(p.b, (degree.get(p.b) || 0) + 1);
  }

  // Every profile becomes a node — including ones with no saves yet, which
  // just render as isolated, unconnected nodes — since this is the sitewide
  // "every user" view, not just the users who happen to be connected.
  const nodes = profiles.map(p => ({
    id: p.id, label: p.username || p.name || tr('anonymous'), avatar_url: p.avatar_url || '', degree: degree.get(p.id) || 0,
  }));
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
  globalFitAllView = null;

  const { nodes, links } = await fetchGlobalGraphData();
  if (token !== globalGraphToken) return; // a newer load superseded this one

  empty.style.display = nodes.length ? 'none' : 'flex';
  if (!nodes.length) return;

  // Built while link.source/link.target are still plain ids (before
  // d3.forceLink below mutates them in place into node object references),
  // so a click handler can cheaply ask "is this node the selected one, or
  // one hop from it" without walking the live simulation links.
  const neighborsOf = new Map();
  for (const l of links) {
    if (!neighborsOf.has(l.source)) neighborsOf.set(l.source, new Set());
    if (!neighborsOf.has(l.target)) neighborsOf.set(l.target, new Set());
    neighborsOf.get(l.source).add(l.target);
    neighborsOf.get(l.target).add(l.source);
  }
  // No one is selected on load, so no connection lines are shown at all —
  // the first click on a node selects it (revealing its local network and
  // zooming to fit); a second click, on that node or any node in its now-
  // visible local network, navigates to that person's profile.
  let selectedId = null;

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
    .attr('dy', d => globalNodeRadius(d) + 12);

  // Draws every node/link/label at its current display position — d.dispX/
  // dispY when the ambient orbit below has taken over that node, else
  // d.x/d.y straight from the simulation (before orbiting starts, and for
  // whichever node is actively being dragged). Only ever *translates* each
  // node/label — never rotates one — so avatar photos and label text stay
  // upright no matter where the node has orbited to.
  function render() {
    link.attr('x1', d => d.source.dispX ?? d.source.x).attr('y1', d => d.source.dispY ?? d.source.y)
        .attr('x2', d => d.target.dispX ?? d.target.x).attr('y2', d => d.target.dispY ?? d.target.y);
    node.attr('transform', d => `translate(${d.dispX ?? d.x},${d.dispY ?? d.y})`);
    label.attr('x', d => d.dispX ?? d.x).attr('y', d => d.dispY ?? d.y);
  }
  // No ambient drift here (unlike the profile page's own local graph) — it
  // never lets the simulation fully settle, so by the time a click's
  // zoom-to-fit transition finishes the nodes have already jittered away
  // from the box it was framed for, and keep drifting further off after.
  // Letting the simulation cool down and stop keeps node positions (and
  // therefore the zoom) stable once settled.
  const sim = d3.forceSimulation(nodes)
    .force('link', d3.forceLink(links).id(d => d.id).distance(90).strength(0.5))
    .force('charge', d3.forceManyBody().strength(-220))
    .force('collide', d3.forceCollide(d => globalNodeRadius(d) + 12))
    .force('x', d3.forceX(width / 2).strength(0.03))
    .force('y', d3.forceY(height / 2).strength(0.03))
    .on('tick', render);
  // See the matching comment in profile-view.js's renderProfileGraphFor:
  // paints real coordinates before the first paint so arrowheads aren't
  // stuck orientation-less on that initial zero-length-line frame.
  render();
  globalGraphSim = sim;

  // ---------- slow ambient orbit ----------
  // Each node drifts in a slow circle around the panel's center at its own
  // settled distance from it, so the layout's overall shape (well-
  // connected nodes clustered near the middle, others further out) is
  // preserved rather than spinning as one rigid disc — and each node keeps
  // its own randomized pace (roughly 0.5x-1.5x of the base rate, picked
  // once and kept for its lifetime), so the motion reads as individually
  // drifting nodes rather than a single mechanism. This only ever moves a
  // node's *position* (d.dispX/dispY, read by render() above) — never its
  // own local orientation — so avatar photos and label text stay upright
  // throughout. Positions are captured once the simulation actually
  // settles (see the sim.on('end', ...) below and the restore path further
  // down); computing them off the transient spawn-cluster positions would
  // orbit around the wrong center entirely.
  const ORBIT_BASE_RAD_PER_MS = (2 * Math.PI) / (5 * 60 * 1000); // ~one full turn every 5 min at 1x speed
  let orbitsInitialized = false;
  let orbitLastElapsed = 0;
  function initOrbitForNode(n, cx, cy) {
    const dx = n.x - cx, dy = n.y - cy;
    n.orbitRadius = Math.hypot(dx, dy);
    n.orbitAngle = Math.atan2(dy, dx);
    if (n.orbitSpeedMul === undefined) n.orbitSpeedMul = 0.5 + Math.random();
  }
  function initOrbits() {
    const cx = width / 2, cy = height / 2;
    for (const n of nodes) initOrbitForNode(n, cx, cy);
  }
  sim.on('end', () => {
    if (orbitsInitialized) return; // only ever the initial settle now that dragging (and its re-baseline) is gone
    orbitsInitialized = true;
    initOrbits();
  });
  // Different nodes orbit at different radii and speeds (that's the whole
  // point — see above), so two of them are bound to cross paths and
  // visually collide sometimes. The collide force that kept nodes apart
  // during the initial settle isn't running any more (the simulation is
  // stopped), so each orbit frame gets its own cheap pairwise separation
  // pass: any pair closer than their combined radii gets nudged apart
  // along the line between them. Recomputed fresh every frame from each
  // node's ideal orbit position (never accumulated), so it reads as a
  // gentle, stable "make room" nudge rather than jitter — and it's O(n^2)
  // over a few dozen nodes, cheap at 60fps.
  const NODE_MIN_GAP = 6;
  function resolveOrbitOverlaps() {
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          const dx = b.dispX - a.dispX, dy = b.dispY - a.dispY;
          const dist = Math.hypot(dx, dy);
          const minDist = globalNodeRadius(a) + globalNodeRadius(b) + NODE_MIN_GAP;
          if (dist >= minDist) continue;
          // Exactly-coincident nodes have no direction to separate along —
          // fall back to a stable, index-derived direction instead of
          // Math.random() so it doesn't jitter frame to frame.
          const nx = dist > 0.01 ? dx / dist : Math.cos(i - j);
          const ny = dist > 0.01 ? dy / dist : Math.sin(i - j);
          const push = (minDist - dist) / 2;
          a.dispX -= nx * push; a.dispY -= ny * push;
          b.dispX += nx * push; b.dispY += ny * push;
        }
      }
    }
  }
  globalRotationTimer = d3.timer(elapsed => {
    const dt = elapsed - orbitLastElapsed;
    orbitLastElapsed = elapsed;
    if (!orbitsInitialized || selectedId != null) return; // paused while zoomed in on a selection, so the fitted frame stays put
    const cx = width / 2, cy = height / 2;
    for (const n of nodes) {
      n.orbitAngle += dt * ORBIT_BASE_RAD_PER_MS * n.orbitSpeedMul;
      n.dispX = cx + n.orbitRadius * Math.cos(n.orbitAngle);
      n.dispY = cy + n.orbitRadius * Math.sin(n.orbitAngle);
    }
    resolveOrbitOverlaps();
    render();
  });

  // Highlights the selected node + its direct neighbors, dims everyone
  // else, and reveals only the connection lines touching the selected
  // node — links stay invisible (see .pg-link in network.css) until
  // something is selected.
  function applySelection() {
    const neighbors = selectedId ? (neighborsOf.get(selectedId) || new Set()) : new Set();
    const isLocal = id => id === selectedId || neighbors.has(id);
    node.classed('pg-selected', d => d.id === selectedId);
    node.classed('pg-dimmed', d => selectedId != null && !isLocal(d.id));
    label.classed('pg-dimmed', d => selectedId != null && !isLocal(d.id));
    link.classed('pg-link-visible', l => selectedId != null && (l.source.id === selectedId || l.target.id === selectedId));
    if (selectedId) zoomToLocalNetwork(isLocal);
  }
  // Shared "pan/scale to fit this set of points" math — pts are current
  // on-screen display positions (dispX/dispY ?? x/y), not raw simulation
  // coordinates, so the fit always matches what's actually rendered right
  // now (e.g. mid-orbit), not where the simulation originally laid a node.
  const FIT_PADDING = 90;
  function fitTransformFor(pts) {
    const minX = Math.min(...pts.map(p => p.x)) - FIT_PADDING, maxX = Math.max(...pts.map(p => p.x)) + FIT_PADDING;
    const minY = Math.min(...pts.map(p => p.y)) - FIT_PADDING, maxY = Math.max(...pts.map(p => p.y)) + FIT_PADDING;
    const scale = Math.max(0.25, Math.min(3, Math.min(width / (maxX - minX), height / (maxY - minY))));
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    return d3.zoomIdentity.translate(width / 2, height / 2).scale(scale).translate(-cx, -cy);
  }
  function currentPoint(n) { return { x: n.dispX ?? n.x, y: n.dispY ?? n.y }; }
  // Pans/scales the view to fit the selected node + its direct neighbors —
  // a one-time fit against their current display positions rather than
  // something that keeps following the (gently, perpetually orbiting)
  // layout afterward.
  function zoomToLocalNetwork(isLocal) {
    const pts = nodes.filter(n => isLocal(n.id)).map(currentPoint);
    if (!pts.length) return;
    svg.transition().duration(400).call(zoomBehavior.transform, fitTransformFor(pts));
  }
  // What the toolbar's reset/100% button drives — fits every node in the
  // graph into view, rather than just snapping back to a literal 1:1 zoom
  // at the origin (which, on a graph this size, usually only showed a
  // corner of it).
  function zoomToFitAll() {
    const pts = nodes.map(currentPoint);
    if (!pts.length) return;
    svg.transition().duration(400).call(zoomBehavior.transform, fitTransformFor(pts));
  }
  globalFitAllView = zoomToFitAll;

  node.on('click', (ev, d) => {
    ev.stopPropagation();
    const neighbors = neighborsOf.get(selectedId);
    if (selectedId != null && (d.id === selectedId || (neighbors && neighbors.has(d.id)))) {
      sessionStorage.setItem(NETWORK_SELECTION_KEY, d.id);
      location.href = profileUrl(d.id);
      return;
    }
    selectedId = d.id;
    applySelection();
  });
  // Clicking empty canvas clears the selection, hiding the connection
  // lines again — node clicks above stop propagation, so this only fires
  // on an actual background click.
  svg.on('click', () => {
    if (selectedId == null) return;
    selectedId = null;
    applySelection();
  });

  // Restore the local network we navigated away from, if this load is the
  // profile page's "Back" button (or browser back) returning here — a
  // fresh visit (nav-bar link, reload with nothing stashed) never has this
  // set, so it only ever fires right after that specific hand-off.
  const restoreId = sessionStorage.getItem(NETWORK_SELECTION_KEY);
  if (restoreId) {
    sessionStorage.removeItem(NETWORK_SELECTION_KEY);
    if (nodes.some(n => n.id === restoreId)) {
      // Right now the nodes are still sitting at their transient spawn
      // positions (a small spiral near the origin) — the simulation's
      // internal timer hasn't run a single frame yet, since that's
      // scheduled async and this is still the same synchronous pass that
      // just created it. Zooming to fit against those would frame the
      // spawn cluster, not the actual laid-out graph, landing far off
      // target. Fast-forward through the settle synchronously (same
      // ~300-tick run the default alphaDecay converges in on its own) so
      // the zoom below is computed against final positions instead —
      // this also means returning here shows the already-settled,
      // already-zoomed local network immediately, with no visible
      // whole-graph spring-into-place first.
      sim.stop();
      for (let i = 0; i < 300 && sim.alpha() > sim.alphaMin(); i++) sim.tick();
      render();
      // Bypassing the normal async settle above means the sim.on('end', ...)
      // listener never fires here — do its job explicitly so orbiting is
      // ready (and paused, since selectedId is about to be set) same as it
      // would be after an organic settle.
      orbitsInitialized = true;
      initOrbits();
      selectedId = restoreId;
      applySelection();
    }
  }
}

authReady.then(() => loadGlobalNetwork());
