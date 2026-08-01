// Home page: hero, stats, carousel, projects grid, admin "new project" modal.
"use strict";

function openProject(id) { location.href = `project.html?id=${encodeURIComponent(id)}`; }

// ---------- projects list ----------
async function renderProjectsGrid() {
  const grid = document.getElementById('projectsGrid');
  const empty = document.getElementById('projectsEmpty');
  grid.innerHTML = '';
  const { data: projects, error } = await sb.from('mosaic_projects')
    .select('id,title,description,width,height')
    .eq('is_archived', false)
    .order('created_at', { ascending: false });
  if (error) { console.error('load projects error:', error); toast(tr('couldNotLoadProjects')); return; }
  empty.style.display = (projects && projects.length) ? 'none' : 'block';
  (projects || []).forEach((p, i) => {
    const card = document.createElement('div'); card.className = 'project-card';
    card.style.animationDelay = `${Math.min(i, 10) * 0.05}s`;
    card.innerHTML = `
      <div class="project-card-inner">
        <canvas></canvas>
        <div class="info">
          <div class="p-title">${escapeHtml(p.title)}</div>
          <div class="p-progress">${tr('loading')}</div>
          <div class="progress-bar"><div class="progress-fill"></div></div>
        </div>
      </div>`;
    card.onclick = () => openProject(p.id);
    grid.appendChild(card);
    paintProjectPreview(card, p);
  });
  renderCarousel(projects || []);
}

// ---------- projects carousel ----------
let carouselTimer = null;
function renderCarousel(projects) {
  const section = document.getElementById('carouselSection');
  const track = document.getElementById('carouselTrack');
  track.innerHTML = '';
  clearInterval(carouselTimer);
  section.classList.toggle('empty', !projects.length);
  if (!projects.length) return;
  projects.forEach((p, i) => {
    const card = document.createElement('div'); card.className = 'carousel-card';
    card.style.animationDelay = `${Math.min(i, 10) * 0.06}s`;
    card.innerHTML = `
      <div class="carousel-card-inner">
        <div class="preview"><canvas></canvas></div>
        <div class="info">
          <div class="p-title">${escapeHtml(p.title)}</div>
          ${p.description ? `<div class="p-desc">${escapeHtml(p.description)}</div>` : ''}
          <div class="p-progress">${tr('loading')}</div>
          <div class="progress-bar"><div class="progress-fill"></div></div>
        </div>
      </div>`;
    card.onclick = () => openProject(p.id);
    track.appendChild(card);
    paintProjectPreview(card, p);
  });
  setupCarousel(projects.length);
}
function setupCarousel(count) {
  const track = document.getElementById('carouselTrack');
  const dotsWrap = document.getElementById('carouselDots');
  const prevBtn = document.getElementById('carPrev');
  const nextBtn = document.getElementById('carNext');

  dotsWrap.innerHTML = '';
  for (let i = 0; i < count; i++) {
    const dot = document.createElement('button');
    dot.className = 'car-dot' + (i === 0 ? ' active' : '');
    dot.setAttribute('aria-label', tr('goToProject', { n: i + 1 }));
    dot.onclick = () => track.scrollTo({ left: i * cardStep(), behavior: 'smooth' });
    dotsWrap.appendChild(dot);
  }
  dotsWrap.style.display = count > 1 ? '' : 'none';

  function cardStep() {
    const card = track.querySelector('.carousel-card');
    return card ? card.getBoundingClientRect().width + 16 : 226;
  }
  function updateNav() {
    const i = Math.round(track.scrollLeft / cardStep());
    dotsWrap.querySelectorAll('.car-dot').forEach((d, idx) => d.classList.toggle('active', idx === i));
    prevBtn.disabled = track.scrollLeft <= 4;
    nextBtn.disabled = track.scrollLeft >= track.scrollWidth - track.clientWidth - 4;
  }
  track.onscroll = () => { clearTimeout(track._t); track._t = setTimeout(updateNav, 80); };
  prevBtn.onclick = () => track.scrollBy({ left: -cardStep(), behavior: 'smooth' });
  nextBtn.onclick = () => track.scrollBy({ left: cardStep(), behavior: 'smooth' });

  function startAutoplay() {
    clearInterval(carouselTimer);
    if (count < 2) return;
    carouselTimer = setInterval(() => {
      const atEnd = track.scrollLeft >= track.scrollWidth - track.clientWidth - 4;
      track.scrollTo({ left: atEnd ? 0 : track.scrollLeft + cardStep(), behavior: 'smooth' });
    }, 4000);
  }
  track.onmouseenter = () => clearInterval(carouselTimer);
  track.onmouseleave = startAutoplay;

  requestAnimationFrame(updateNav);
  startAutoplay();
}

document.getElementById('scrollHint').onclick = () => {
  document.getElementById('projectsPanel').scrollIntoView({ behavior: 'smooth' });
};

// ---------- admin: create project (needs js/color-engine.js for imageToColorGrid) ----------
const refPicker = setupPicker('ref-picker');
document.getElementById('newProjectBtn').onclick = () => {
  if (!me.id) { openAuthModal(); return; }
  document.getElementById('np-title').value = '';
  document.getElementById('np-desc').value = '';
  document.getElementById('np-width').value = '';
  document.getElementById('np-height').value = '';
  document.getElementById('np-error').textContent = '';
  refPicker.reset();
  document.getElementById('new-project-modal').classList.add('open');
};
document.getElementById('np-cancel').onclick = () => document.getElementById('new-project-modal').classList.remove('open');
document.getElementById('new-project-modal').addEventListener('click', e => { if (e.target === e.currentTarget) e.currentTarget.classList.remove('open'); });

document.getElementById('np-submit').onclick = async () => {
  const title = document.getElementById('np-title').value.trim();
  const description = document.getElementById('np-desc').value.trim();
  const width = parseInt(document.getElementById('np-width').value, 10);
  const height = parseInt(document.getElementById('np-height').value, 10);
  const errorEl = document.getElementById('np-error');
  const file = refPicker.getFile();
  if (!title) { errorEl.textContent = tr('titleRequired'); return; }
  if (!file) { errorEl.textContent = tr('addReferenceImage'); return; }
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 100 || height > 100 || width * height > 10000) {
    errorEl.textContent = tr('widthHeightRange');
    return;
  }
  errorEl.textContent = '';
  const btn = document.getElementById('np-submit');
  btn.disabled = true;
  toast(tr('creatingProject'));
  let projectId = null;
  try {
    const imgEl = await loadImageEl(refPicker.getPreviewEl().src);
    const cells = imageToColorGrid(imgEl, width, height);
    if (!cells.length) {
      errorEl.textContent = tr('imageFullyTransparent');
      return;
    }
    const referenceUrl = await uploadImage(file);
    if (!referenceUrl) return;
    const { data: project, error: projErr } = await sb.from('mosaic_projects').insert({
      title, description: description || null, width, height,
      reference_image_url: referenceUrl, created_by: me.id
    }).select().single();
    if (projErr || !project) {
      console.error('weavo project insert error:', projErr);
      toast(tr('couldNotCreateProjectMsg', { msg: projErr ? projErr.message : 'unknown error' }));
      return;
    }
    projectId = project.id;
    const rows = cells.map(c => ({ project_id: project.id, ...c }));
    for (let i = 0; i < rows.length; i += 500) {
      const { error: pxErr } = await sb.from('mosaic_pixels').insert(rows.slice(i, i + 500));
      if (pxErr) throw pxErr;
    }
    document.getElementById('new-project-modal').classList.remove('open');
    const skipped = width * height - cells.length;
    toast(projectCreatedToast(skipped));
    openProject(project.id);
  } catch (err) {
    console.error('weavo pixel insert error:', err);
    toast(tr('couldNotCreateProjectRetry'));
    if (projectId) await sb.from('mosaic_projects').delete().eq('id', projectId);
  } finally {
    btn.disabled = false;
  }
};

authReady.then(() => renderProjectsGrid());
