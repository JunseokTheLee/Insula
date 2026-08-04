// Shared "paint a project's grid as a small canvas" renderer — filled cells
// shown as their average color, not the actual artwork (indistinguishable at
// this size, and loading a real thumbnail per filled cell for every project
// on every page view was the single biggest driver of Supabase storage
// egress). Used by home.js (project cards + carousel, on projects.html) and
// landing.js (hero preview, on index.html) — split out here so neither page
// duplicates it.
// Needs sb (supabase-client.js) and luminance (color-engine.js) already loaded.
"use strict";

const PREVIEW_CELL_PX = 24;

// home.js paints each project's preview twice (grid card + carousel card) —
// this cache means that only issues one mosaic_pixels query per project per
// page load instead of two.
const previewPixelsCache = new Map();
function getCachedProjectPixels(projectId) {
  if (!previewPixelsCache.has(projectId)) {
    previewPixelsCache.set(projectId, sb.from('mosaic_pixels')
      .select('x,y,target_r,target_g,target_b,filled,mosaic_submissions!mosaic_pixels_submission_id_fkey(avg_r,avg_g,avg_b)')
      .eq('project_id', projectId)
      .then(({ data, error }) => {
        if (error) console.error('load preview pixels error:', error);
        return data || [];
      }));
  }
  return previewPixelsCache.get(projectId);
}

async function paintProjectPreview(card, project) {
  const canvas = card.querySelector('canvas');
  canvas.classList.add('loading');
  const pixels = await getCachedProjectPixels(project.id);
  canvas.width = project.width * PREVIEW_CELL_PX;
  canvas.height = project.height * PREVIEW_CELL_PX;
  canvas.style.aspectRatio = `${project.width} / ${project.height}`;
  const ctx = canvas.getContext('2d');
  let filledCount = 0;
  for (const px of pixels) {
    const dx = px.x * PREVIEW_CELL_PX, dy = px.y * PREVIEW_CELL_PX;
    if (px.filled && px.mosaic_submissions) {
      filledCount++;
      const sub = px.mosaic_submissions;
      ctx.fillStyle = `rgb(${sub.avg_r},${sub.avg_g},${sub.avg_b})`;
    } else {
      const l = Math.round(luminance(px.target_r, px.target_g, px.target_b));
      ctx.fillStyle = `rgb(${l},${l},${l})`;
    }
    ctx.fillRect(dx, dy, PREVIEW_CELL_PX, PREVIEW_CELL_PX);
  }
  canvas.classList.remove('loading');
  const total = pixels.length;
  const progEl = card.querySelector('.p-progress');
  if (progEl) progEl.textContent = filledText(filledCount, total);
  const fill = card.querySelector('.progress-fill');
  if (fill) fill.style.width = `${total ? Math.round((filledCount / total) * 100) : 0}%`;
}
