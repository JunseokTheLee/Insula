// Cross-project artwork matching. Artwork is uploaded to a profile (see
// profile-view.js) independent of any project, and lands in mosaic_submissions
// with project_id/pixel_id null. This module places pool pieces into open
// cells wherever a good color match exists, across every non-archived
// project at once — not just the one the uploader happens to be looking at.
//
// There's no cron/server process in this stack (static Cloudflare Pages site
// + Supabase), so matching isn't run on a schedule. Instead runPoolMatching()
// is called right after anything that changes either side of the match —
// a new upload, a new project's cells coming online, a reshape changing
// which cells are open, or a piece being removed from a project — from
// profile-view.js, home.js, project.js and lightbox.js respectively. Needs
// sb and color-engine.js's colorDistanceSq/POOR_MATCH_DISTANCE loaded first.
"use strict";

// Greedy, not a full assignment-problem solve: each pool piece (oldest
// upload first, so the queue is fair) claims whatever still-open cell is
// closest to it, one at a time, same approach as the old per-project
// assignToClosestCells. A true global optimum would need re-solving (and
// potentially reshuffling) every open project's existing placements too,
// which conflicts with pieces only ever moving via an explicit
// reshape/removal — greedy keeps each match final and cheap to compute.
async function runPoolMatchingOnce() {
  const { data: pool, error: poolErr } = await sb.from('mosaic_submissions')
    .select('id,avg_r,avg_g,avg_b')
    .is('project_id', null)
    .order('created_at', { ascending: true });
  if (poolErr) { console.error('fetch pool artwork error:', poolErr); return []; }
  if (!pool || !pool.length) return [];

  const { data: cells, error: cellErr } = await sb.from('mosaic_pixels')
    .select('id,target_r,target_g,target_b,mosaic_projects!inner(is_archived)')
    .eq('filled', false)
    .eq('mosaic_projects.is_archived', false);
  if (cellErr) { console.error('fetch open cells error:', cellErr); return []; }
  if (!cells || !cells.length) return [];

  const pending = cells.slice();
  const assignments = [];
  for (const item of pool) {
    let bestIdx = -1, bestDist = Infinity;
    const itemColor = { r: item.avg_r, g: item.avg_g, b: item.avg_b };
    for (let i = 0; i < pending.length; i++) {
      const d = colorDistanceSq(itemColor, {
        r: pending[i].target_r, g: pending[i].target_g, b: pending[i].target_b
      });
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    if (bestIdx === -1) break; // no open cells left anywhere
    if (Math.sqrt(bestDist) > POOR_MATCH_DISTANCE) continue; // no good fit yet — stays pooled, retried next trigger
    const cell = pending.splice(bestIdx, 1)[0];
    assignments.push({ submission_id: item.id, pixel_id: cell.id });
  }
  if (!assignments.length) return [];

  const { error: rpcErr } = await sb.rpc('commit_pool_matches', { p_assignments: assignments });
  if (rpcErr) { console.error('commit_pool_matches error:', rpcErr); return []; }
  return assignments;
}

// Four call sites (profile-view.js, home.js, project.js, lightbox.js) can
// all trigger this within moments of each other — e.g. an admin reshaping
// right after someone uploads. Without coalescing, each call independently
// re-fetches the entire pool and every open cell across every active
// project, so overlapping triggers multiply that read cost instead of
// sharing it. `currentRun` collapses concurrent calls onto whichever pass
// is already in flight; `queuedRun`, if a call arrives mid-pass, chains
// exactly one follow-up pass after it (so a change made *during* the
// in-flight fetch still gets picked up) rather than starting a fresh pass
// per caller.
let currentRun = null;
let queuedRun = null;
function runPoolMatching() {
  if (currentRun) {
    if (!queuedRun) {
      queuedRun = currentRun
        .catch(() => {})
        .then(() => runPoolMatching())
        .finally(() => { queuedRun = null; });
    }
    return queuedRun;
  }
  currentRun = runPoolMatchingOnce().finally(() => { currentRun = null; });
  return currentRun;
}
