// Shared d3-force helpers for the two save-relationship graphs (profile's
// own network and the sitewide network page).
"use strict";

// Ambient wander: keeps a tiny bit of alpha in the simulation forever
// (instead of letting it settle to a dead stop) and nudges each free node's
// velocity by a small random amount every tick. The existing link/charge/
// collide/x/y forces keep pulling everything back toward equilibrium, so
// the net effect reads as a slight organic drift rather than the layout
// freezing in place once it first settles.
const GRAPH_DRIFT_ALPHA_TARGET = 0.02;
const GRAPH_DRIFT_STRENGTH = 5;
function driftForce(nodes) {
  return (alpha) => {
    for (const d of nodes) {
      if (d.fx != null) continue; // pinned — being dragged, or the local graph's center node
      d.vx += (Math.random() - 0.5) * GRAPH_DRIFT_STRENGTH * alpha;
      d.vy += (Math.random() - 0.5) * GRAPH_DRIFT_STRENGTH * alpha;
    }
  };
}
function truncateLabel(s) { return s.length > 14 ? s.slice(0, 13) + '…' : s; }
