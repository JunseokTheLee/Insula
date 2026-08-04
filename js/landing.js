// Landing page: hero preview canvas, stats bar, and latest-artworks grid.
// Needs js/project-preview.js (paintProjectPreview) loaded first.
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

// ---------- latest artworks ----------
// A real <a href> to the standalone artwork page (crawlable, ctrl/cmd-
// clickable into a new tab), but a plain click opens it in the same
// in-page lightbox modal used by project.html/profile.html instead — see
// interceptClick in common.js and its identical use in project.js's
// projectListCardEl. Author avatar is a plain image (not miniAvatarEl's
// profile-linking <a>) since it sits inside this card's own <a> and
// nested anchors aren't valid HTML.
function artworkCardEl(sub, i) {
  const name = sub.author_name || tr('anonymous');
  const card = document.createElement('a');
  card.className = 'artwork-card';
  card.href = artworkUrl(sub.id);
  card.style.animationDelay = `${Math.min(i, 10) * 0.05}s`;
  interceptClick(card, () => openLightbox(sub));

  const img = document.createElement('img');
  img.className = 'artwork-card-img';
  img.src = cdnUrl(sub.thumb_url || sub.image_url);
  img.alt = '';
  card.appendChild(img);

  const info = document.createElement('div'); info.className = 'info';
  const title = document.createElement('div');
  title.className = 'art-title'; title.textContent = sub.art_title || tr('untitledArtwork');
  const byline = document.createElement('div'); byline.className = 'art-byline';
  if (sub.author_avatar_url) {
    const avatar = document.createElement('img');
    avatar.className = 'art-byline-avatar'; avatar.src = cdnUrl(sub.author_avatar_url); avatar.alt = '';
    byline.appendChild(avatar);
  } else {
    const fallback = document.createElement('div');
    fallback.className = 'art-byline-avatar art-byline-avatar-fallback';
    fallback.textContent = name.charAt(0).toUpperCase();
    byline.appendChild(fallback);
  }
  const nameSpan = document.createElement('span'); nameSpan.className = 'art-byline-name'; nameSpan.textContent = name;
  byline.appendChild(nameSpan);
  const date = document.createElement('div'); date.className = 'art-date'; date.textContent = fmtShortDate(sub.created_at);
  info.append(title, byline, date);
  card.appendChild(info);
  return card;
}
function renderRecentArtworks(list) {
  const grid = document.getElementById('recentArtworksGrid');
  grid.innerHTML = '';
  list.forEach((sub, i) => grid.appendChild(artworkCardEl(sub, i)));
  document.getElementById('recentArtworksEmpty').style.display = list.length ? 'none' : 'block';
}
async function loadRecentArtworks() {
  const { data, error } = await sb.from('mosaic_submissions')
    .select('id,pixel_id,project_id,image_url,thumb_url,art_title,art_material,art_completed_date,art_description,art_link,author_id,author_name,author_avatar_url,created_at')
    .order('created_at', { ascending: false })
    .limit(5);
  if (error) { console.error('load recent artworks error:', error); toast(tr('couldNotLoadArtworks')); return; }
  renderRecentArtworks(data || []);
}

document.getElementById('scrollHint').onclick = () => {
  document.getElementById('recentArtworksPanel').scrollIntoView({ behavior: 'smooth' });
};

// The lightbox's delete/remove-from-project actions (js/lightbox.js) call
// this after they succeed, same hook project.html/profile.html/artwork.js
// define — refreshes the grid so a deleted/removed piece doesn't linger.
window.onSubmissionDeleted = () => loadRecentArtworks();

authReady.then(() => { loadHeroPreview(); renderStats(); loadRecentArtworks(); });
