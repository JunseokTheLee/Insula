// Shared "paint a project's grid as a small canvas, filled cells cropped to
// a thumbnail of the submitted artwork" renderer. Used by home.js (project
// cards + carousel, on projects.html) and landing.js (hero preview, on
// index.html) — split out here so neither page duplicates it.
// Needs sb (supabase-client.js), loadImageEl (common.js), luminance
// (color-engine.js) and filledText (js/i18n/{en,ko}.js) already loaded.
"use strict";

// Preview canvases render each cell at PREVIEW_CELL_PX physical pixels
// (rather than 1:1) so filled cells can show a cropped thumbnail of the
// actual submitted artwork instead of just its average color.
const PREVIEW_CELL_PX = 24;
const previewImageCache = new Map();
function getCachedPreviewImage(url) {
  if (!previewImageCache.has(url)) previewImageCache.set(url, loadImageEl(url).catch(() => null));
  return previewImageCache.get(url);
}
// Same crop-to-fill behavior as CSS background-size:cover, for drawing an
// image into a square canvas cell without distorting its aspect ratio.
function drawImageCover(ctx, img, dx, dy, dw, dh) {
  const iw = img.naturalWidth, ih = img.naturalHeight;
  if (!iw || !ih) return;
  const ir = iw / ih, dr = dw / dh;
  let sx, sy, sw, sh;
  if (ir > dr) { sh = ih; sw = sh * dr; sx = (iw - sw) / 2; sy = 0; }
  else { sw = iw; sh = sw / dr; sx = 0; sy = (ih - sh) / 2; }
  ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
}
async function paintProjectPreview(card, project) {
  const canvas = card.querySelector('canvas');
  canvas.classList.add('loading');
  const { data: pixels } = await sb.from('mosaic_pixels')
    .select('x,y,target_r,target_g,target_b,filled,mosaic_submissions!mosaic_pixels_submission_id_fkey(image_url,thumb_url,avg_r,avg_g,avg_b)')
    .eq('project_id', project.id);
  canvas.width = project.width * PREVIEW_CELL_PX;
  canvas.height = project.height * PREVIEW_CELL_PX;
  canvas.style.aspectRatio = `${project.width} / ${project.height}`;
  const ctx = canvas.getContext('2d');
  let filledCount = 0;
  for (const px of pixels || []) {
    const dx = px.x * PREVIEW_CELL_PX, dy = px.y * PREVIEW_CELL_PX;
    if (px.filled && px.mosaic_submissions) {
      filledCount++;
      const sub = px.mosaic_submissions;
      // Paint the average color immediately so the grid looks complete
      // right away, then swap in the real artwork once it's loaded.
      ctx.fillStyle = `rgb(${sub.avg_r},${sub.avg_g},${sub.avg_b})`;
      ctx.fillRect(dx, dy, PREVIEW_CELL_PX, PREVIEW_CELL_PX);
      getCachedPreviewImage(sub.thumb_url || sub.image_url).then(img => {
        if (img) drawImageCover(ctx, img, dx, dy, PREVIEW_CELL_PX, PREVIEW_CELL_PX);
      });
    } else {
      const l = Math.round(luminance(px.target_r, px.target_g, px.target_b));
      ctx.fillStyle = `rgb(${l},${l},${l})`;
      ctx.fillRect(dx, dy, PREVIEW_CELL_PX, PREVIEW_CELL_PX);
    }
  }
  canvas.classList.remove('loading');
  const total = (pixels || []).length;
  const progEl = card.querySelector('.p-progress');
  if (progEl) progEl.textContent = filledText(filledCount, total);
  const fill = card.querySelector('.progress-fill');
  if (fill) fill.style.width = `${total ? Math.round((filledCount / total) * 100) : 0}%`;
}
