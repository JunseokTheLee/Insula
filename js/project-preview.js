// Shared "paint a project's grid as a small canvas" renderer. Filled cells
// are painted with the piece's average color first, then overdrawn with its
// micro thumbnail (the ~16 px JPEG data URI carried in the row — see
// common.js artworkDerivativesFromImage) once that decodes, so the preview
// shows tiny pictures without one image request per piece; a row without
// one (or the column not applied yet) simply keeps the average color. Used
// by home.js (project cards + carousel, on campaigns.html) and landing.js
// (hero preview, on index.html) — split out here so neither page duplicates
// it.
// Cell colors come from the project's static grid image when it has one
// (common.js loadProjectCells — one small cached PNG instead of every
// mosaic_pixels row); only the filled cells are read from the database.
// Open cells are grey at the previewContrast / previewBrightness /
// previewTint site options (common.js openCellPainter).
// Needs sb, common.js (loadProjectCells, fetchAllRows, openCellPainter,
// getSiteSettings) and luminance (color-engine.js) already loaded.
"use strict";

const PREVIEW_CELL_PX = 24;

// home.js paints each project's preview twice (grid card + carousel card) —
// this cache means the grid image / filled-cell query happen once per
// project per page load instead of twice.
const previewGridCache = new Map();
// Filled cells with their piece's average color and micro thumbnail; asked
// again without micro_thumb while supabase_mosaic_micro_thumbs.sql hasn't
// been applied (unknown column → schema mismatch).
async function fetchPreviewFilled(project, withMicro) {
  const cols = 'x,y,mosaic_submissions!mosaic_pixels_submission_id_fkey(avg_r,avg_g,avg_b,author_id' + (withMicro ? ',micro_thumb' : '') + ')';
  const res = await fetchAllRows(
    () => sb.from('mosaic_pixels').select(cols)
      .eq('project_id', project.id).eq('filled', true).not('submission_id', 'is', null),
    { expected: project.width * project.height }
  );
  if (res.error && withMicro && isSchemaMismatchError(res.error)) return fetchPreviewFilled(project, false);
  return res;
}
function getCachedProjectGrid(project) {
  if (!previewGridCache.has(project.id)) {
    previewGridCache.set(project.id, Promise.all([
      loadProjectCells(project),
      fetchPreviewFilled(project, true),
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
  // A stale common.js from before the grey options (cache transition,
  // CLAUDE.md §12) has no openCellPainter — draw the plain luminance it
  // always drew rather than fail.
  const paint = typeof openCellPainter === 'function' ? openCellPainter(cells, await getSiteSettings()) : (r, g, b) => { const l = Math.round(luminance(r, g, b)); return `rgb(${l},${l},${l})`; };
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
      ctx.fillStyle = paint(px.target_r, px.target_g, px.target_b);
    }
    ctx.fillRect(dx, dy, PREVIEW_CELL_PX, PREVIEW_CELL_PX);
  }
  // Tiny pictures over the average-color squares; awaited so a caller that
  // copies the canvas elsewhere (the landing hero) gets them too.
  await paintPreviewMicroThumbs(ctx, cells, filled);
  canvas.classList.remove('loading');
  const total = cells.length;
  const progEl = card.querySelector('.p-progress');
  if (progEl) progEl.textContent = filledText(filledCount, total);
  const fill = card.querySelector('.progress-fill');
  if (fill) fill.style.width = `${total ? Math.round((filledCount / total) * 100) : 0}%`;
  return { filledCount, total };
}
async function paintPreviewMicroThumbs(ctx, cells, filled) {
  const jobs = [];
  for (const px of cells) {
    const sub = filled.get(`${px.x},${px.y}`);
    if (!sub || !sub.micro_thumb) continue;
    jobs.push(loadImageEl(sub.micro_thumb).then(img => {
      ctx.drawImage(img, px.x * PREVIEW_CELL_PX, px.y * PREVIEW_CELL_PX, PREVIEW_CELL_PX, PREVIEW_CELL_PX);
    }).catch(() => { /* a bad data URI just leaves the average color */ }));
  }
  await Promise.all(jobs);
}
