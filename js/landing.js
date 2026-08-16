// Landing page: hero preview canvas, stats bar, and the latest-artworks/
// -exhibitions lists (the first thing on the page, above the hero).
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

// ---------- latest artworks (list) ----------
// A real <a href> to the standalone artwork page (crawlable, ctrl/cmd-
// clickable into a new tab), but a plain click opens it in the same
// in-page lightbox modal used by project.html/profile.html instead — see
// recentListRowEl's onPlainClick param (common.js).
function artworkListRowEl(sub) {
  return recentListRowEl({
    href: artworkUrl(sub.id),
    thumbUrl: cdnUrl(sub.thumb_url || sub.image_url),
    title: sub.art_title || tr('untitledArtwork'),
    avatarUrl: sub.author_avatar_url ? cdnUrl(sub.author_avatar_url) : null,
    name: sub.author_name || tr('anonymous'),
    metaText: fmtShortDate(sub.created_at),
    onPlainClick: () => openLightbox(sub),
  });
}
function renderRecentArtworks(list) {
  const el = document.getElementById('recentArtworksList');
  el.innerHTML = '';
  list.forEach(sub => el.appendChild(artworkListRowEl(sub)));
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

// ---------- latest exhibitions (list) ----------
// fetchPublishedExhibitions/fetchExhibitionOwners/collectionCoverUrl are
// shared with the /exhibitions browse-all page — see js/common.js. Only
// published, public, not-(yet-)expired exhibitions are queried, so a draft
// or an expired one never leaks onto the landing page.
function exhibitionListRowEl(collection, owner) {
  const name = (owner && (owner.username || owner.name)) || tr('anonymous');
  return recentListRowEl({
    href: collectionUrl(collection.id),
    thumbUrl: collectionCoverUrl(collection),
    title: collection.title,
    avatarUrl: owner && owner.avatar_url ? cdnUrl(owner.avatar_url) : null,
    name,
    metaText: collectionItemCountText((collection.mosaic_collection_items || []).length),
  });
}
function renderRecentCollections(list, owners) {
  const el = document.getElementById('recentCollectionsList');
  el.innerHTML = '';
  list.forEach(c => el.appendChild(exhibitionListRowEl(c, owners[c.owner_id])));
  document.getElementById('recentCollectionsEmpty').style.display = list.length ? 'none' : 'block';
}
async function loadRecentCollections() {
  const collections = await fetchPublishedExhibitions(5);
  renderRecentCollections(collections, await fetchExhibitionOwners(collections));
}

document.getElementById('scrollHint').onclick = () => {
  document.getElementById('howItWorksPanel').scrollIntoView({ behavior: 'smooth' });
};

// The lightbox's delete/remove-from-project actions (js/lightbox.js) call
// this after they succeed, same hook project.html/profile.html/artwork.js
// define — refreshes the grid so a deleted/removed piece doesn't linger.
window.onSubmissionDeleted = () => loadRecentArtworks();

authReady.then(() => { loadHeroPreview(); renderStats(); loadRecentArtworks(); loadRecentCollections(); });
