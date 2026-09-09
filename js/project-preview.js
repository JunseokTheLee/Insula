// Shared "paint a project's grid as a small canvas" renderer — filled cells
// shown as their average color, not the actual artwork (indistinguishable at
// this size, and loading a real thumbnail per filled cell for every project
// on every page view was the single biggest driver of Supabase storage
// egress). Used by home.js (project cards + carousel, on campaigns.html) and
// landing.js (hero preview, on index.html) — split out here so neither page
// duplicates it.
// Cell colors come from the project's static grid image when it has one
// (common.js loadProjectCells — one small cached PNG instead of every
// mosaic_pixels row); only the filled cells are read from the database.
// Needs sb, common.js (loadProjectCells, fetchAllRows) and luminance
// (color-engine.js) already loaded.
"use strict";

const PREVIEW_CELL_PX = 24;

// home.js paints each project's preview twice (grid card + carousel card) —
// this cache means the grid image / filled-cell query happen once per
// project per page load instead of twice.
const previewGridCache = new Map();
function getCachedProjectGrid(project) {
  if (!previewGridCache.has(project.id)) {
    previewGridCache.set(project.id, Promise.all([
      loadProjectCells(project),
      fetchAllRows(
        () => sb.from('mosaic_pixels')
          .select('x,y,mosaic_submissions!mosaic_pixels_submission_id_fkey(avg_r,avg_g,avg_b)')
          .eq('project_id', project.id).eq('filled', true).not('submission_id', 'is', null),
        { expected: project.width * project.height }
      ),
    ]).then(([grid, filledRes]) => {
      if (filledRes.error) console.error('load preview filled cells error:', filledRes.error);
      const filled = new Map();
      for (const px of filledRes.data || []) if (px.mosaic_submissions) filled.set(`${px.x},${px.y}`, px.mosaic_submissions);
      return { cells: grid.cells, filled };
    }));
  }
  return previewGridCache.get(project.id);
}

async function paintProjectPreview(card, project) {
  const canvas = card.querySelector('canvas');
  canvas.classList.add('loading');
  const { cells, filled } = await getCachedProjectGrid(project);
  canvas.width = project.width * PREVIEW_CELL_PX;
  canvas.height = project.height * PREVIEW_CELL_PX;
  canvas.style.aspectRatio = `${project.width} / ${project.height}`;
  const ctx = canvas.getContext('2d');
  let filledCount = 0;
  for (const px of cells) {
    const dx = px.x * PREVIEW_CELL_PX, dy = px.y * PREVIEW_CELL_PX;
    const sub = filled.get(`${px.x},${px.y}`);
    if (sub) {
      filledCount++;
      ctx.fillStyle = `rgb(${sub.avg_r},${sub.avg_g},${sub.avg_b})`;
    } else {
      const l = Math.round(luminance(px.target_r, px.target_g, px.target_b));
      ctx.fillStyle = `rgb(${l},${l},${l})`;
    }
    ctx.fillRect(dx, dy, PREVIEW_CELL_PX, PREVIEW_CELL_PX);
  }
  canvas.classList.remove('loading');
  const total = cells.length;
  const progEl = card.querySelector('.p-progress');
  if (progEl) progEl.textContent = filledText(filledCount, total);
  const fill = card.querySelector('.progress-fill');
  if (fill) fill.style.width = `${total ? Math.round((filledCount / total) * 100) : 0}%`;
  return { filledCount, total };
}
