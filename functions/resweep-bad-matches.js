// One-off cleanup: re-check every already-placed piece against the NEW,
// stricter POOR_MATCH_DISTANCE (30, was 60 — see js/color-engine.js) and
// return anything that no longer qualifies back to its artist's pool.
// The threshold change only gates *future* matching passes (runPoolMatching
// in js/matching.js); it doesn't touch rows that were already committed to a
// project under the old, looser value, so those stay visible until swept.
//
// HOW TO RUN:
//   1. Sign in as an admin (unmatch_submission requires is_admin, or being
//      the piece's own author — an admin can sweep everyone's).
//   2. Open the site's home page (index.html) — it's one of the pages that
//      already loads js/color-engine.js and js/matching.js, so `sb`,
//      `colorDistanceSq`, `POOR_MATCH_DISTANCE`, and `runPoolMatching` all
//      exist in the page's console already.
//   3. Open devtools console, paste this whole file, hit enter.
//   4. It defaults to DRY_RUN — logs what WOULD be unmatched without
//      changing anything. Read the count, then set DRY_RUN = false below
//      and re-run to actually sweep.
const DRY_RUN = false;

(async () => {
  const { data: rows, error } = await fetchAllRows(() => sb.from('mosaic_pixels')
    .select('id,target_r,target_g,target_b,project_id,mosaic_projects!inner(is_archived),mosaic_submissions!mosaic_pixels_submission_id_fkey(id,avg_r,avg_g,avg_b,project_id)', { count: 'exact' })
    .eq('filled', true)
    .not('submission_id', 'is', null)
    .eq('mosaic_projects.is_archived', false));
  if (error) { console.error('fetch error:', error); return; }

  const bad = [];
  for (const px of rows) {
    const s = px.mosaic_submissions;
    if (!s) continue; // filled-but-stale-claim row, no submission attached yet
    const dist = Math.sqrt(colorDistanceSq(
      { r: s.avg_r, g: s.avg_g, b: s.avg_b },
      { r: px.target_r, g: px.target_g, b: px.target_b }
    ));
    if (dist > POOR_MATCH_DISTANCE) bad.push({ submissionId: s.id, projectId: px.project_id, dist });
  }

  console.log(`${bad.length} of ${rows.length} placed pieces exceed POOR_MATCH_DISTANCE (${POOR_MATCH_DISTANCE}).`);
  bad.sort((a, b) => b.dist - a.dist);
  console.table(bad.map(b => ({ submission: b.submissionId, project: b.projectId, distance: b.dist.toFixed(1) })));

  if (DRY_RUN) {
    console.log('DRY RUN — nothing changed. Set DRY_RUN = false and re-paste to actually sweep these.');
    return;
  }

  let unmatched = 0;
  for (const b of bad) {
    const { error: unmatchErr } = await sb.rpc('unmatch_submission', { p_submission_id: b.submissionId });
    if (unmatchErr) console.error('unmatch failed for submission', b.submissionId, unmatchErr);
    else unmatched++;
  }
  console.log(`unmatched ${unmatched}/${bad.length}. Re-running pool matching once so any that fit a better cell elsewhere get placed...`);
  const reassigned = await runPoolMatching();
  console.log(`pool matching placed ${reassigned.length} piece(s) into a better-fitting cell; the rest stay pooled until a good fit opens up.`);
})();
