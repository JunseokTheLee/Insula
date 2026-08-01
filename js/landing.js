// Landing page: hero preview canvas + stats bar. Needs js/project-preview.js
// (paintProjectPreview) loaded first.
"use strict";

async function loadHeroPreview() {
  const { data: projects, error } = await sb.from('mosaic_projects')
    .select('id,title,description,width,height')
    .eq('is_archived', false)
    .order('created_at', { ascending: false });
  if (error) { console.error('load projects error:', error); return; }
  renderHeroPreview(projects || []);
}
// Reuses paintProjectPreview against a minimal stand-in for a project
// card — that function only ever looks up '.p-progress'/'.progress-fill'
// conditionally, so a plain canvas with no surrounding card markup works
// fine as the hero's "what people are building" preview.
function renderHeroPreview(projects) {
  const canvas = document.getElementById('heroPreviewCanvas');
  const emptyEl = document.getElementById('heroPreviewEmpty');
  const featured = projects[0];
  if (!featured) {
    canvas.style.display = 'none';
    emptyEl.style.display = '';
    return;
  }
  canvas.style.display = '';
  emptyEl.style.display = 'none';
  paintProjectPreview({ querySelector: sel => (sel === 'canvas' ? canvas : null) }, featured);
}
async function renderStats() {
  const { data, error } = await sb.from('mosaic_stats').select('*').maybeSingle();
  if (error) { console.error('load weavo stats error:', error); return; }
  if (!data) return;
  document.getElementById('statArtists').textContent = data.artist_count ?? 0;
  document.getElementById('statArtworks').textContent = data.artwork_count ?? 0;
  document.getElementById('statProjects').textContent = data.project_count ?? 0;
  document.getElementById('statFill').textContent = `${data.fill_percent ?? 0}%`;
}

authReady.then(() => { loadHeroPreview(); renderStats(); });
