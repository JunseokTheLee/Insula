// Project detail page: weavo grid, list view, upload/reshape (admin), and
// the weavo grid's own pan/zoom. Reads the project id from ?id=.
"use strict";

let currentProject = null;

// Client-side fallback for the tab title/social-preview tags, in case this
// page is reached without going through the Pages Function that pre-renders
// them server-side (see functions/[lang]/projects/[id].js).
function updateProjectMeta(project) {
  const title = `${project.title} | Weavo`;
  const description = project.description
    ? project.description.slice(0, 300)
    : (CURRENT_LANG === 'ko' ? `Weavo의 공동 모자이크 프로젝트 '${project.title}'.` : `A collaborative mosaic project on Weavo: ${project.title}.`);
  updatePageMeta({ title, description, canonical: `${location.origin}${projectUrl(project.id)}`, image: project.reference_image_url });
}
function renderProjectJsonLd(project) {
  const url = `${location.origin}${projectUrl(project.id)}`;
  const data = {
    '@context': 'https://schema.org', '@type': 'CreativeWork',
    name: project.title, url, image: project.reference_image_url,
  };
  if (project.description) data.description = project.description;
  const breadcrumb = {
    '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Weavo', item: `${location.origin}/${CURRENT_LANG}/` },
      { '@type': 'ListItem', position: 2, name: tr('projectsCrumb'), item: `${location.origin}/${CURRENT_LANG}/projects` },
      { '@type': 'ListItem', position: 3, name: project.title, item: url },
    ],
  };
  injectJsonLd([data, breadcrumb]);
}

// ---------- project detail ----------
async function openProject(id) {
  const { data: project, error } = await sb.from('mosaic_projects').select('*').eq('id', id).maybeSingle();
  if (error || !project) { console.error('load project error:', error); toast(tr('projectNotFound')); return; }
  currentProject = project;
  history.replaceState(null, '', projectUrl(project.id));
  document.getElementById('reshapeProjectBtn').style.display = (me.isAdmin && !project.is_archived) ? '' : 'none';
  document.getElementById('uploadArtBtn').style.display = project.is_archived ? 'none' : '';
  const banner = document.getElementById('archivedBanner');
  if (project.is_archived) {
    document.getElementById('archivedBannerText').textContent = tr('archivedIterationLabel', { version: project.version_number });
    document.getElementById('archivedBannerLink').onclick = () => openProject(project.current_project_id);
    banner.style.display = '';
  } else {
    banner.style.display = 'none';
  }
  document.getElementById('projectTitle').textContent = project.title;
  updateProjectMeta(project);
  renderProjectJsonLd(project);
  const descEl = document.getElementById('projectDesc');
  descEl.textContent = project.description || '';
  descEl.style.display = project.description ? '' : 'none';
  const refPreview = document.getElementById('referencePreview');
  refPreview.classList.remove('enlarged');
  refPreview.setAttribute('aria-label', tr('enlargePreview'));
  refPreview.style.display = '';
  renderReferencePreview(project);
  setProjectViewMode('weavo');
  if (!project.is_archived) await sweepStaleClaims(project.id);
  await renderWeavoGrid(project);
  if (!project.is_archived) renderColorsNeeded(project);
  else document.getElementById('colorsNeeded').style.display = 'none';
}
// ---------- project detail: weavo / list view toggle ----------
let projectViewMode = 'weavo';
function setProjectViewMode(mode) {
  projectViewMode = mode;
  document.getElementById('pvTabWeavo').classList.toggle('active', mode === 'weavo');
  document.getElementById('pvTabList').classList.toggle('active', mode === 'list');
  document.getElementById('weavoGridWrap').style.display = mode === 'weavo' ? '' : 'none';
  document.getElementById('projectListView').style.display = mode === 'list' ? '' : 'none';
}
document.getElementById('pvTabWeavo').onclick = () => setProjectViewMode('weavo');
document.getElementById('pvTabList').onclick   = () => setProjectViewMode('list');
// Corner "what this is supposed to look like" preview — painted straight
// from each cell's exact target_r/g/b, not the uploaded reference photo,
// so it shows the same full-color grid the weavo is assembling toward
// rather than a smooth, unpixelated image.
const REF_PREVIEW_CELL_PX = 6;
async function renderReferencePreview(project) {
  const canvas = document.getElementById('referencePreviewCanvas');
  const { data: pixels, error } = await sb.from('mosaic_pixels')
    .select('x,y,target_r,target_g,target_b')
    .eq('project_id', project.id);
  if (error) { console.error('load reference preview colors error:', error); return; }
  canvas.width = project.width * REF_PREVIEW_CELL_PX;
  canvas.height = project.height * REF_PREVIEW_CELL_PX;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#1c1c22';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (const px of pixels || []) {
    ctx.fillStyle = `rgb(${px.target_r},${px.target_g},${px.target_b})`;
    ctx.fillRect(px.x * REF_PREVIEW_CELL_PX, px.y * REF_PREVIEW_CELL_PX, REF_PREVIEW_CELL_PX, REF_PREVIEW_CELL_PX);
  }
}
// Groups still-open cells' exact target colors into clusters of visually
// similar shades — a greedy single-pass clustering by actual color
// distance (same Lab-based metric as matching, see colorDistanceSq), not
// a fixed rounding grid, so colors that only differ by a channel or two
// (e.g. 127 vs 129) always land in the same group instead of being
// arbitrarily split across a bucket boundary.
const COLOR_GROUP_DISTANCE = 30;
const MAX_COLOR_SWATCHES = 10;
async function renderColorsNeeded(project) {
  const wrap = document.getElementById('colorsNeeded');
  const swatchesEl = document.getElementById('colorSwatches');
  const { data: openPixels, error } = await sb.from('mosaic_pixels')
    .select('target_r,target_g,target_b')
    .eq('project_id', project.id).eq('filled', false);
  if (error) { console.error('load open pixel colors error:', error); wrap.style.display = 'none'; return; }
  if (!openPixels || !openPixels.length) { wrap.style.display = 'none'; return; }

  // Collapse exact-duplicate colors first — cheap, and shrinks the input
  // to the clustering pass below to the number of distinct shades.
  const exact = new Map();
  for (const px of openPixels) {
    const key = `${px.target_r},${px.target_g},${px.target_b}`;
    const entry = exact.get(key);
    if (entry) entry.count++;
    else exact.set(key, { r: px.target_r, g: px.target_g, b: px.target_b, count: 1 });
  }
  const distinct = [...exact.values()].sort((a, b) => b.count - a.count);

  // Walk distinct colors most-common first, attaching each to the nearest
  // existing cluster if it's within COLOR_GROUP_DISTANCE, else starting a
  // new cluster. The centroid is a running count-weighted average so it
  // settles near the group's true center as more colors join it.
  const clusters = [];
  for (const c of distinct) {
    let best = null, bestDist = Infinity;
    for (const cl of clusters) {
      const d = Math.sqrt(colorDistanceSq(c, cl));
      if (d < bestDist) { bestDist = d; best = cl; }
    }
    if (best && bestDist <= COLOR_GROUP_DISTANCE) {
      const total = best.count + c.count;
      best.r = Math.round((best.r * best.count + c.r * c.count) / total);
      best.g = Math.round((best.g * best.count + c.g * c.count) / total);
      best.b = Math.round((best.b * best.count + c.b * c.count) / total);
      best.count = total;
    } else {
      clusters.push({ r: c.r, g: c.g, b: c.b, count: c.count });
    }
  }
  clusters.sort((a, b) => b.count - a.count);

  const shown = clusters.slice(0, MAX_COLOR_SWATCHES);
  const remainder = clusters.slice(MAX_COLOR_SWATCHES).reduce((sum, c) => sum + c.count, 0);

  swatchesEl.innerHTML = shown.map(c => `
    <div class="color-swatch">
      <div class="swatch-dot" style="background:rgb(${c.r},${c.g},${c.b});" title="${escapeHtml(openCellTooltip(c))}"></div>
      <div class="swatch-count">${c.count}</div>
    </div>`).join('')
    + (remainder > 0 ? `
    <div class="color-swatch">
      <div class="swatch-dot more" title="${escapeHtml(moreCellsTooltip(remainder))}">+${remainder}</div>
      <div class="swatch-count">${tr('moreLabel')}</div>
    </div>` : '');
  wrap.style.display = '';
}
async function renderWeavoGrid(project) {
  const grid = document.getElementById('weavoGrid');
  grid.style.gridTemplateColumns = `repeat(${project.width}, 1fr)`;
  grid.style.gridTemplateRows = `repeat(${project.height}, 1fr)`;
  grid.innerHTML = '';
  fitWeavoStage(project);
  resetMsZoom();
  const { data: pixels, error } = await sb.from('mosaic_pixels')
    .select('id,x,y,target_r,target_g,target_b,filled,submission_id,mosaic_submissions!mosaic_pixels_submission_id_fkey(id,image_url,thumb_url,author_id,author_name,author_avatar_url,art_title,art_description,art_link,created_at)')
    .eq('project_id', project.id)
    .order('y', { ascending: true })
    .order('x', { ascending: true });
  if (error) { console.error('load pixels error:', error); toast(tr('couldNotLoadWeavo')); return; }
  let filledCount = 0;
  const filledSubs = [];
  for (const px of pixels || []) {
    const isFilled = !!(px.filled && px.submission_id && px.mosaic_submissions);
    // Filled cells are real links to the artwork's own page (crawlable,
    // shareable, ctrl/cmd-clickable into a new tab); still-open cells have
    // nothing to link to yet, so those stay plain divs.
    const cell = document.createElement(isFilled ? 'a' : 'div');
    cell.className = 'weavo-cell';
    cell.dataset.pixelId = px.id;
    // Explicit placement, not DOM order — cells excluded from the grid
    // (e.g. transparent regions of the reference image) leave real gaps
    // instead of shifting every following cell out of position.
    cell.style.gridColumn = String(px.x + 1);
    cell.style.gridRow = String(px.y + 1);
    applyCellVisual(cell, px);
    if (isFilled) {
      filledCount++;
      cell.classList.add('filled');
      const sub = { ...px.mosaic_submissions, pixel_id: px.id };
      cell.href = artworkUrl(sub.id);
      interceptClick(cell, () => { if (!weavoSuppressClick) openLightbox(sub); });
      filledSubs.push(sub);
    }
    grid.appendChild(cell);
  }
  document.getElementById('projectProgress').textContent = filledText(filledCount, (pixels || []).length);
  renderProjectList(filledSubs);
}
// List view: every artwork currently in the project, newest first — a
// browsable alternative to hunting for a piece inside the weavo grid.
function renderProjectList(subs) {
  const grid = document.getElementById('projectListGrid');
  const empty = document.getElementById('projectListEmpty');
  grid.innerHTML = '';
  const sorted = [...subs].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  empty.style.display = sorted.length ? 'none' : 'block';
  for (const sub of sorted) grid.appendChild(projectListCardEl(sub));
}
function projectListCardEl(sub) {
  const card = document.createElement('a');
  card.className = 'pv-card';
  card.href = artworkUrl(sub.id);
  interceptClick(card, () => openLightbox(sub));
  const thumb = document.createElement('div');
  thumb.className = 'pv-card-thumb';
  const img = document.createElement('img');
  img.src = sub.thumb_url || sub.image_url;
  img.alt = sub.art_title
    ? tr('artworkThumbAlt', { title: sub.art_title, name: sub.author_name || tr('anonymous') })
    : tr('artworkImgAltFallback', { name: sub.author_name || tr('anonymous') });
  thumb.appendChild(img);
  card.appendChild(thumb);
  const info = document.createElement('div');
  info.className = 'pv-card-info';
  const title = document.createElement('div');
  title.className = 'pv-card-title'; title.textContent = sub.art_title || '';
  const author = document.createElement('div');
  author.className = 'pv-card-author'; author.textContent = sub.author_name || tr('anonymous');
  info.append(title, author);
  card.appendChild(info);
  return card;
}
function applyCellVisual(cell, px) {
  if (px.filled && px.submission_id && px.mosaic_submissions) {
    cell.style.backgroundImage = `url("${px.mosaic_submissions.thumb_url || px.mosaic_submissions.image_url}")`;
  } else {
    const l = Math.round(luminance(px.target_r, px.target_g, px.target_b));
    cell.style.backgroundImage = '';
    cell.style.backgroundColor = `rgb(${l},${l},${l})`;
  }
}
async function sweepStaleClaims(projectId) {
  const staleBefore = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  await sb.from('mosaic_pixels')
    .update({ filled: false, submission_id: null, claimed_by: null, claimed_at: null })
    .eq('project_id', projectId).eq('filled', true).is('submission_id', null)
    .lt('claimed_at', staleBefore);
}

// ---------- weavo grid pan/zoom ----------
const weavoWrap = document.getElementById('weavoGridWrap');
const msStage = document.getElementById('weavoStage');
const msZoomLevelEl = document.getElementById('weavo-zoom-level');
const msZoomInBtn = document.getElementById('weavo-zoom-in');
const msZoomOutBtn = document.getElementById('weavo-zoom-out');
const MS_MIN_ZOOM = 1, MS_MAX_ZOOM = 8, MS_ZOOM_STEP = 0.6;
let msScale = 1, msX = 0, msY = 0, msBaseW = 0, msBaseH = 0;
let weavoSuppressClick = false;

// Fit the stage to the wrap's viewport ("contain" — full weavo always
// visible at 100%), so the grid's cells stay square regardless of the
// project's width/height ratio.
function fitWeavoStage(project) {
  const availW = weavoWrap.clientWidth, availH = weavoWrap.clientHeight;
  const ratio = project.width / project.height;
  let w = availW, h = w / ratio;
  if (h > availH) { h = availH; w = h * ratio; }
  msBaseW = w; msBaseH = h;
  msStage.style.width = `${w}px`;
  msStage.style.height = `${h}px`;
}
function clampMsPan() {
  const maxX = Math.max(0, (msBaseW * msScale - weavoWrap.clientWidth) / 2);
  const maxY = Math.max(0, (msBaseH * msScale - weavoWrap.clientHeight) / 2);
  msX = Math.min(maxX, Math.max(-maxX, msX));
  msY = Math.min(maxY, Math.max(-maxY, msY));
}
function applyMsTransform() {
  msStage.style.transform = `translate(${msX}px, ${msY}px) scale(${msScale})`;
  msZoomLevelEl.textContent = `${Math.round(msScale * 100)}%`;
  msZoomOutBtn.disabled = msScale <= MS_MIN_ZOOM;
  msZoomInBtn.disabled = msScale >= MS_MAX_ZOOM;
  weavoWrap.classList.toggle('zoomed', msScale > MS_MIN_ZOOM);
}
function setMsZoom(scale) {
  msScale = Math.min(MS_MAX_ZOOM, Math.max(MS_MIN_ZOOM, scale));
  if (msScale === MS_MIN_ZOOM) { msX = 0; msY = 0; } else { clampMsPan(); }
  applyMsTransform();
}
function resetMsZoom() { msScale = 1; msX = 0; msY = 0; applyMsTransform(); }

msZoomInBtn.onclick = () => setMsZoom(msScale + MS_ZOOM_STEP);
msZoomOutBtn.onclick = () => setMsZoom(msScale - MS_ZOOM_STEP);
document.getElementById('weavo-zoom-reset').onclick = () => setMsZoom(MS_MIN_ZOOM);

document.getElementById('referencePreview').onclick = () => {
  const el = document.getElementById('referencePreview');
  const enlarged = el.classList.toggle('enlarged');
  el.setAttribute('aria-label', enlarged ? tr('shrinkPreview') : tr('enlargePreview'));
};
weavoWrap.addEventListener('wheel', e => {
  e.preventDefault();
  setMsZoom(msScale + (e.deltaY < 0 ? MS_ZOOM_STEP : -MS_ZOOM_STEP));
}, { passive: false });
addEventListener('resize', () => { if (currentProject) fitWeavoStage(currentProject); });

// drag-to-pan (mouse) when zoomed in — a plain click (no movement) still
// reaches the cell underneath so viewing artwork keeps working while zoomed.
let msDragging = false, msDidDrag = false, msStartX = 0, msStartY = 0, msOrigX = 0, msOrigY = 0;
weavoWrap.addEventListener('mousedown', e => {
  if (msScale <= MS_MIN_ZOOM) return;
  e.preventDefault();
  msDragging = true; msDidDrag = false;
  msStartX = e.clientX; msStartY = e.clientY;
  msOrigX = msX; msOrigY = msY;
  msStage.classList.add('no-transition');
  weavoWrap.classList.add('dragging');
});
addEventListener('mousemove', e => {
  if (!msDragging) return;
  const dx = e.clientX - msStartX, dy = e.clientY - msStartY;
  if (!msDidDrag && Math.hypot(dx, dy) > 4) msDidDrag = true;
  if (!msDidDrag) return;
  msX = msOrigX + dx; msY = msOrigY + dy;
  clampMsPan();
  applyMsTransform();
});
addEventListener('mouseup', () => {
  if (msDragging && msDidDrag) { weavoSuppressClick = true; setTimeout(() => { weavoSuppressClick = false; }, 0); }
  msDragging = false;
  msStage.classList.remove('no-transition');
  weavoWrap.classList.remove('dragging');
});

// pinch-to-zoom / one-finger pan (touch)
function msTouchDist(touches) {
  return Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
}
let msPinchStartDist = 0, msPinchStartScale = 1;
weavoWrap.addEventListener('touchstart', e => {
  if (e.touches.length === 2) {
    msPinchStartDist = msTouchDist(e.touches);
    msPinchStartScale = msScale;
    msStage.classList.add('no-transition');
  } else if (e.touches.length === 1 && msScale > MS_MIN_ZOOM) {
    msDragging = true; msDidDrag = false;
    msStartX = e.touches[0].clientX; msStartY = e.touches[0].clientY;
    msOrigX = msX; msOrigY = msY;
    msStage.classList.add('no-transition');
  }
}, { passive: true });
weavoWrap.addEventListener('touchmove', e => {
  if (e.touches.length === 2 && msPinchStartDist) {
    e.preventDefault();
    setMsZoom(msPinchStartScale * (msTouchDist(e.touches) / msPinchStartDist));
  } else if (e.touches.length === 1 && msDragging) {
    e.preventDefault();
    const dx = e.touches[0].clientX - msStartX, dy = e.touches[0].clientY - msStartY;
    if (!msDidDrag && Math.hypot(dx, dy) > 4) msDidDrag = true;
    msX = msOrigX + dx; msY = msOrigY + dy;
    clampMsPan();
    applyMsTransform();
  }
}, { passive: false });
weavoWrap.addEventListener('touchend', () => {
  if (msDragging && msDidDrag) { weavoSuppressClick = true; setTimeout(() => { weavoSuppressClick = false; }, 0); }
  msDragging = false; msPinchStartDist = 0;
  msStage.classList.remove('no-transition');
});

// ---------- admin: reshape project ----------
const reshapePicker = setupPicker('reshape-ref-picker');
document.getElementById('reshapeProjectBtn').onclick = () => {
  if (!me.isAdmin || !currentProject) return;
  document.getElementById('rs-width').value = currentProject.width;
  document.getElementById('rs-height').value = currentProject.height;
  document.getElementById('rs-error').textContent = '';
  reshapePicker.reset();
  document.getElementById('reshape-project-modal').classList.add('open');
};
document.getElementById('rs-cancel').onclick = () => document.getElementById('reshape-project-modal').classList.remove('open');
document.getElementById('reshape-project-modal').addEventListener('click', e => { if (e.target === e.currentTarget) e.currentTarget.classList.remove('open'); });

document.getElementById('rs-submit').onclick = async () => {
  const project = currentProject;
  if (!project) return;
  const width = parseInt(document.getElementById('rs-width').value, 10);
  const height = parseInt(document.getElementById('rs-height').value, 10);
  const errorEl = document.getElementById('rs-error');
  const file = reshapePicker.getFile();
  if (!file) { errorEl.textContent = tr('addReferenceImage'); return; }
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 100 || height > 100 || width * height > 10000) {
    errorEl.textContent = tr('widthHeightRange');
    return;
  }
  errorEl.textContent = '';
  const btn = document.getElementById('rs-submit');
  btn.disabled = true;
  try {
    const imgEl = await loadImageEl(reshapePicker.getPreviewEl().src);
    const cells = imageToColorGrid(imgEl, width, height);
    if (!cells.length) { errorEl.textContent = tr('imageFullyTransparent'); return; }

    const { data: subData, error: subErr } = await sb.from('mosaic_submissions')
      .select('id,avg_r,avg_g,avg_b').eq('project_id', project.id);
    if (subErr) { console.error('load submissions for reshape error:', subErr); toast(tr('couldNotReshapeProjectRetry')); return; }
    const submissions = subData || [];

    if (cells.length < submissions.length) {
      errorEl.textContent = tr('reshapeTooSmallMsg', { needed: submissions.length, have: submissions.length });
      return;
    }

    const proceed = await confirmDialog(
      tr('reshapeConfirmMessage', { count: submissions.length, plural: submissions.length === 1 ? '' : 's' }),
      { title: tr('reshapeConfirmTitle'), okLabel: tr('reshapeConfirmOk') }
    );
    if (!proceed) return;

    toast(tr('reshapingProject'));
    const referenceUrl = await uploadImage(file);
    if (!referenceUrl) return;

    // Each surviving submission claims the closest-matching cell in the
    // new grid; the rest of the new grid is left open for future uploads.
    const matched = assignToClosestCells(
      submissions.map(s => ({ id: s.id, r: s.avg_r, g: s.avg_g, b: s.avg_b })),
      cells
    );
    const assignments = matched.map(({ item, cell }) => ({ submission_id: item.id, x: cell.x, y: cell.y }));
    const rpcCells = cells.map(c => ({ x: c.x, y: c.y, r: c.target_r, g: c.target_g, b: c.target_b }));

    const { error: rpcErr } = await sb.rpc('reshape_mosaic_project', {
      p_project_id: project.id,
      p_new_width: width,
      p_new_height: height,
      p_new_reference_url: referenceUrl,
      p_cells: rpcCells,
      p_assignments: assignments
    });
    if (rpcErr) {
      console.error('reshape_mosaic_project error:', rpcErr);
      toast(tr('couldNotReshapeProjectMsg', { msg: rpcErr.message }));
      return;
    }

    document.getElementById('reshape-project-modal').classList.remove('open');
    toast(tr('projectReshaped'));
    openProject(project.id);
  } catch (err) {
    console.error('reshape project error:', err);
    toast(tr('couldNotReshapeProjectRetry'));
  } finally {
    btn.disabled = false;
  }
};

// ---------- upload artwork ----------
const artPicker = setupPicker('art-picker');
document.getElementById('uploadArtBtn').onclick = () => {
  if (!me.id) { openAuthModal(); return; }
  artPicker.reset();
  document.getElementById('ua-title').value = '';
  document.getElementById('ua-desc').value = '';
  document.getElementById('ua-link').value = '';
  document.getElementById('ua-error').textContent = '';
  document.getElementById('upload-art-modal').classList.add('open');
};
function closeUploadArtModal() { document.getElementById('upload-art-modal').classList.remove('open'); }
document.getElementById('ua-cancel').onclick = closeUploadArtModal;
document.getElementById('upload-art-modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeUploadArtModal(); });
document.getElementById('ua-submit').onclick = () => {
  const file = artPicker.getFile();
  const errorEl = document.getElementById('ua-error');
  if (!file) { errorEl.textContent = tr('addImageFirst'); return; }
  if (!currentProject) return;
  const link = document.getElementById('ua-link').value.trim();
  if (link && !safeHref(link)) { errorEl.textContent = tr('linkMustBeValidUrl'); return; }
  errorEl.textContent = '';
  const meta = {
    title: document.getElementById('ua-title').value.trim(),
    description: document.getElementById('ua-desc').value.trim(),
    link
  };
  submitAndRearrange(currentProject, file, meta);
};

// Every new upload recomputes the best-fit placement for the ENTIRE
// project (existing pieces + the new one) rather than just slotting the
// new piece into whatever open cell is closest — so as more art comes in,
// earlier pieces can get bumped to a still-better-matching cell too. The
// actual rearrangement write happens atomically server-side (see
// submit_mosaic_artwork_rearranged in supabase_mosaic_rearrange.sql); this
// just computes the candidate assignment and retries if another upload
// landed first and made that computation stale.
const REARRANGE_MAX_RETRIES = 3;
async function submitAndRearrange(project, file, meta) {
  const btn = document.getElementById('ua-submit');
  btn.disabled = true;
  toast(tr('findingBestSpot'));
  try {
    const previewImg = await loadImageEl(artPicker.getPreviewEl().src);
    const avg = imageAverageColor(previewImg);

    const { data: cellRows, error: cellErr } = await sb.from('mosaic_pixels')
      .select('id,target_r,target_g,target_b')
      .eq('project_id', project.id);
    if (cellErr) { console.error('fetch weavo cells error:', cellErr); toast(tr('couldNotSubmitRetry')); return; }
    const cells = cellRows || [];
    if (!cells.length) { toast(tr('weavoComplete')); return; }

    let imageUrl = null, thumbUrl = null;
    for (let attempt = 0; attempt < REARRANGE_MAX_RETRIES; attempt++) {
      const { data: subRows, error: subErr } = await sb.from('mosaic_submissions')
        .select('id,avg_r,avg_g,avg_b')
        .eq('project_id', project.id);
      if (subErr) { console.error('fetch weavo submissions error:', subErr); toast(tr('couldNotSubmitRetry')); return; }
      const submissions = subRows || [];
      if (cells.length < submissions.length + 1) { toast(tr('weavoComplete')); return; }

      const items = submissions.map(s => ({ id: s.id, r: s.avg_r, g: s.avg_g, b: s.avg_b }));
      items.push({ id: null, r: avg.r, g: avg.g, b: avg.b });
      const matched = improveAssignmentWithSwaps(assignToClosestCells(items, cells));
      const newMatch = matched.find(m => m.item.id === null);

      if (attempt === 0) {
        const bestDistance = Math.sqrt(colorDistanceSq(avg, {
          r: newMatch.cell.target_r, g: newMatch.cell.target_g, b: newMatch.cell.target_b
        }));
        if (bestDistance > POOR_MATCH_DISTANCE) {
          const proceed = await confirmDialog(
            tr('noCloseMatchMessage'),
            { title: tr('noCloseMatchTitle'), okLabel: tr('submitAnyway') }
          );
          if (!proceed) return;
        }
      }

      if (imageUrl === null) {
        toast(tr('uploadingToast'));
        const uploaded = await uploadArtworkImage(file);
        imageUrl = uploaded.url;
        thumbUrl = uploaded.thumbUrl;
        if (!imageUrl) return;
      }

      toast(tr('rearrangingToast'));
      const assignments = matched
        .filter(m => m.item.id !== null)
        .map(m => ({ submission_id: m.item.id, pixel_id: m.cell.id }));

      const { error: rpcErr } = await sb.rpc('submit_mosaic_artwork_rearranged', {
        p_project_id: project.id,
        p_image_url: imageUrl,
        p_thumb_url: thumbUrl,
        p_avg_r: avg.r, p_avg_g: avg.g, p_avg_b: avg.b,
        p_art_title: meta.title || null, p_art_description: meta.description || null, p_art_link: meta.link || null,
        p_author_name: me.username || me.name, p_author_avatar_url: me.avatar || null,
        p_new_pixel_id: newMatch.cell.id,
        p_assignments: assignments
      });
      if (!rpcErr) {
        closeUploadArtModal();
        toast(tr('artworkSubmittedToast'));
        renderWeavoGrid(project);
        renderColorsNeeded(project);
        return;
      }
      console.error('submit_mosaic_artwork_rearranged error (attempt ' + attempt + '):', rpcErr);
      // Falls through to retry — another upload likely landed between the
      // fetch above and this call, so the assignment is recomputed fresh.
    }
    toast(tr('couldNotSubmitRetry'));
  } finally {
    btn.disabled = false;
  }
}

window.onSubmissionDeleted = () => {
  if (currentProject) { renderWeavoGrid(currentProject); renderColorsNeeded(currentProject); }
};

authReady.then(async () => {
  const id = routeParam('projects', 'id');
  if (!id) { toast(tr('projectNotFound')); return; }
  await openProject(id);
});
