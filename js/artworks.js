// Browse Artworks page (/{lang}/artworks) — every submitted artwork across
// the whole site, newest first by default, with a client-side name/title
// search and a Newest/Most Liked sort toggle. Modeled on js/artists.js's
// allArtists/filterArtists/renderArtists shape. No category/medium filter:
// submissions only carry a free-text art_material field, not a real
// category enum, so there's no reliable data to filter pills against.
"use strict";

let allArtworks = [];
let artworksSort = 'newest';

function artworkCardEl(sub, i) {
  const name = sub.author_name || tr('anonymous');
  const card = document.createElement('a');
  card.className = 'artwork-card';
  card.href = artworkUrl(sub.id);
  card.style.animationDelay = `${Math.min(i, 10) * 0.05}s`;

  const img = document.createElement('img');
  img.className = 'artwork-card-img';
  img.loading = 'lazy';
  img.src = cdnUrl(sub.thumb_url || sub.image_url);
  img.alt = sub.art_title
    ? tr('artworkThumbAlt', { title: sub.art_title, name })
    : tr('artworkImgAltFallback', { name });
  card.appendChild(img);

  const info = document.createElement('div'); info.className = 'info';
  const title = document.createElement('div');
  title.className = 'art-title'; title.textContent = sub.art_title || '';
  const byline = document.createElement('div'); byline.className = 'art-byline';
  if (sub.author_avatar_url) {
    const avatar = document.createElement('img');
    avatar.className = 'art-byline-avatar'; avatar.loading = 'lazy'; avatar.src = cdnUrl(sub.author_avatar_url); avatar.alt = '';
    byline.appendChild(avatar);
  } else {
    const fallback = document.createElement('div');
    fallback.className = 'art-byline-avatar art-byline-avatar-fallback';
    fallback.textContent = name.charAt(0).toUpperCase();
    byline.appendChild(fallback);
  }
  const nameSpan = document.createElement('span'); nameSpan.className = 'art-byline-name'; nameSpan.textContent = name;
  byline.appendChild(nameSpan);
  const date = document.createElement('div'); date.className = 'art-date';
  date.textContent = fmtShortDate(sub.created_at);
  info.append(title, byline, date);
  card.appendChild(info);
  return card;
}

function renderArtworks(list) {
  const grid = document.getElementById('artworksGrid');
  grid.innerHTML = '';
  list.forEach((sub, i) => grid.appendChild(artworkCardEl(sub, i)));
  document.getElementById('artworksEmpty').style.display = list.length ? 'none' : 'block';
}

function filterAndSortArtworks(query) {
  const q = query.trim().toLowerCase();
  let list = !q ? allArtworks : allArtworks.filter(sub => {
    const title = (sub.art_title || '').toLowerCase();
    const name = (sub.author_name || '').toLowerCase();
    return title.includes(q) || name.includes(q);
  });
  if (artworksSort === 'liked') list = [...list].sort((a, b) => (b.likeCount || 0) - (a.likeCount || 0));
  return list;
}
function applyArtworksFilters() {
  renderArtworks(filterAndSortArtworks(document.getElementById('artworkSearchInput').value));
}
document.getElementById('artworkSearchInput').oninput = () => applyArtworksFilters();
document.getElementById('artworkSortSelect').onchange = e => {
  artworksSort = e.target.value;
  applyArtworksFilters();
};

// Like counts aren't embedded on mosaic_submissions — one extra query over
// just the ids already on the page, counted client-side (same shape as
// js/lightbox.js's per-submission like fetch, just batched).
async function fetchLikeCounts(submissionIds) {
  const counts = {};
  if (!submissionIds.length) return counts;
  const { data, error } = await sb.from('mosaic_submission_likes')
    .select('submission_id').in('submission_id', submissionIds);
  if (error) { console.error('load artwork like counts error:', error); return counts; }
  for (const row of data || []) counts[row.submission_id] = (counts[row.submission_id] || 0) + 1;
  return counts;
}

async function loadArtworks() {
  const { data, error } = await sb.from('mosaic_submissions')
    .select('id,image_url,thumb_url,art_title,author_id,author_name,author_avatar_url,created_at')
    .order('created_at', { ascending: false });
  if (error) { console.error('load artworks error:', error); toast(tr('couldNotLoadArtworks')); return; }
  allArtworks = (data || []).filter(sub => !isUserBlocked(sub.author_id));
  const counts = await fetchLikeCounts(allArtworks.map(sub => sub.id));
  for (const sub of allArtworks) sub.likeCount = counts[sub.id] || 0;
  applyArtworksFilters();
}

authReady.then(() => loadArtworks());
