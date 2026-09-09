// Landing page: hero (copy, campaign mosaic, pieces / pledge progress),
// stats bar, and the latest-artworks / -exhibitions lists below the hero.
// Needs js/project-preview.js (paintProjectPreview) loaded first.
"use strict";

async function loadHeroPreview() {
  const { data: projects, error } = await sb.from('mosaic_projects')
    .select('*')
    .eq('is_archived', false)
    .order('created_at', { ascending: false });
  if (error) { console.error('load projects error:', error); return; }
  renderHeroPreview(projects || []);
}
// Reuses paintProjectPreview against a minimal stand-in for a project
// card — that function only ever looks up '.p-progress'/'.progress-fill'
// conditionally, so a plain canvas with no surrounding card markup works
// fine as the hero's "what people are building" preview.
async function renderHeroPreview(projects) {
  const canvas = document.getElementById('heroPreviewCanvas');
  const emptyEl = document.getElementById('heroPreviewEmpty');
  const featured = projects[0];
  if (!featured) {
    canvas.style.display = 'none';
    emptyEl.style.display = '';
    renderHeroProgress(0, 0);
    return;
  }
  canvas.style.display = '';
  emptyEl.style.display = 'none';
  document.getElementById('heroCampaignLink').href = projectUrl(featured.id);
  const { filledCount, total } = await paintProjectPreview({ querySelector: sel => (sel === 'canvas' ? canvas : null) }, featured);
  renderHeroProgress(filledCount, total);
}
// Pieces / percent / "donated so far" for the featured campaign. The pledge
// amount is a placeholder read from data-pledge on #heroProgress until
// campaigns carry their own donor and pledge fields; donated-so-far is
// pledge × filled/total, rounded to the nearest ₩1,000.
function renderHeroProgress(filled, total) {
  const wrap = document.getElementById('heroProgress');
  const pledge = parseInt(wrap.dataset.pledge, 10) || 0;
  const share = total ? filled / total : 0;
  const fmt = n => n.toLocaleString(CURRENT_LANG === 'ko' ? 'ko-KR' : 'en-US');
  const set = (id, v) => { document.getElementById(id).textContent = v; };
  set('heroPieces', fmt(filled));
  set('heroPiecesTotal', fmt(total));
  set('heroTotalInline', fmt(total));
  set('heroTotalCaption', fmt(total));
  set('heroPercent', `${Math.round(share * 100)}%`);
  document.getElementById('heroProgressFill').style.width = `${Math.round(share * 1000) / 10}%`;
  set('heroDonation', fmt(Math.round(pledge * share / 1000) * 1000));
  set('heroPledge', fmt(pledge));
  document.querySelectorAll('.hero-pledge-inline').forEach(el => { el.textContent = fmt(pledge); });
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
  // Fetched past the display count (5) so filtering out blocked authors
  // below doesn't leave the list looking sparse.
  const { data, error } = await sb.from('mosaic_submissions')
    .select('id,pixel_id,project_id,image_url,thumb_url,art_title,art_material,art_completed_date,art_description,art_link,author_id,author_name,author_avatar_url,created_at')
    .order('created_at', { ascending: false })
    .limit(30);
  if (error) { console.error('load recent artworks error:', error); toast(tr('couldNotLoadArtworks')); return; }
  renderRecentArtworks((data || []).filter(sub => !isUserBlocked(sub.author_id)).slice(0, 5));
}

// ---------- latest exhibitions (list) ----------
// fetchPublishedExhibitions/fetchExhibitionOwners/collectionCoverUrl are
// shared with the /exhibitions browse-all page — see js/common.js. Only
// published, public, not-(yet-)expired exhibitions are queried, so a draft
// or an expired one never leaks onto the landing page.
function exhibitionListRowEl(collection, owner) {
  const name = (owner && owner.username) || tr('anonymous');
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

// Artwork is uploaded from the artist's own profile (the upload modal only
// exists on profile.html), so this just routes there — signed out, it opens
// the auth modal instead. The #upload hash tells profile-view.js to pop the
// upload modal straight away.
document.getElementById('heroUploadBtn').onclick = () => {
  if (!me.id) { openAuthModal(); return; }
  location.href = profileUrl(me.id) + '#upload';
};

// The lightbox's delete/remove-from-project actions (js/lightbox.js) call
// this after they succeed, same hook project.html/profile.html/artwork.js
// define — refreshes the grid so a deleted/removed piece doesn't linger.
window.onSubmissionDeleted = () => loadRecentArtworks();
window.onSubmissionUpdated = () => loadRecentArtworks();

authReady.then(() => { loadHeroPreview(); renderStats(); loadRecentArtworks(); loadRecentCollections(); });
