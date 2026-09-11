// Browse Artworks page (/{lang}/artworks) — every submitted artwork across
// the site, ARTWORKS_PAGE at a time from the server: newest first, or by
// like_count for "Most liked", with a server-side title/author search. The
// first version loaded every row in one query and searched/sorted in the
// browser, which would have stopped silently at Supabase's 1,000-row cap
// and broken the like-count lookup (an `in(...)` over every id). Like
// counts now come from mosaic_submissions.like_count, kept by a trigger on
// mosaic_submission_likes (supabase_mosaic_like_count.sql); until that SQL
// is applied the page falls back to newest-first without counts.
// Needs common.js (sb, cdnUrl, artworkUrl, ARTWORK_ROW_COLS, fmtShortDate,
// isUserBlocked, isSchemaMismatchError), auth.js (authReady) and
// lightbox.js (openLightbox — cards open in place rather than navigating)
// loaded first.
"use strict";

const ARTWORKS_PAGE = 60;
let artworksSort = 'newest';
let artworksQuery = '';
let artworksOffset = 0;   // rows fetched so far for the current search + sort
let artworksShown = 0;    // cards on the page (blocked authors are skipped)
let artworksDone = false; // the server sent a short page: nothing more to load
let artworksLoading = false;
let artworksRun = 0;      // bumped on every new search/sort so a stale page is ignored
let artworksHasLikeCount = true; // false once the column turns out to be missing
let artworksHasPieces = true; // false once parent_id (supabase_mosaic_pieces.sql) turns out to be missing

function artworkCardEl(sub, i) {
  const name = sub.author_name || tr('anonymous');
  const card = document.createElement('a');
  card.className = 'artwork-card';
  card.href = artworkUrl(sub.id);
  card.dataset.id = String(sub.id);
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

  // Open in the lightbox instead of navigating: this page loads 60 artworks
  // at a time and a visitor browsing it can be many "Load more" clicks deep,
  // all of which a round trip to the artwork page and back would throw away.
  // The href stays real so crawlers, middle-click and ctrl/cmd-click still
  // reach the artwork's own indexable URL.
  card.onclick = e => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    openLightbox(sub);
  };
  return card;
}

// A deleted artwork (the lightbox's own Delete, author or admin) leaves the
// grid without a reload — lightbox.js calls this hook.
window.onSubmissionDeleted = sub => {
  const card = document.querySelector(`.artwork-card[data-id="${sub.id}"]`);
  if (card) { card.remove(); artworksShown--; }
  if (typeof closeLightbox === 'function') closeLightbox();
};

// ---------- paging ----------
// PostgREST filter value: double-quoted so commas / parentheses in the
// search text can't break the `or=(…)` syntax; `*` is its wildcard.
function artworksSearchValue() {
  return `"*${artworksQuery.replace(/"/g, '').split(String.fromCharCode(92)).join('')}*"`;
}
function artworksPageQuery() {
  // The same column set the profile grid feeds the lightbox with
  // (common.js ARTWORK_ROW_COLS) — clicking a card opens it here too, so
  // the row must already carry the description, link and material rather
  // than costing one more request per artwork opened.
  const cols = ARTWORK_ROW_COLS
    + (artworksHasPieces ? ',piece_n,home_project_id' : '')
    + (artworksHasLikeCount ? ',like_count' : '');
  let q = sb.from('mosaic_submissions').select(cols);
  if (artworksHasPieces) q = q.is('parent_id', null); // pieces are not artworks
  if (artworksQuery) {
    const v = artworksSearchValue();
    q = q.or(`art_title.ilike.${v},author_name.ilike.${v}`);
  }
  if (artworksSort === 'liked' && artworksHasLikeCount) q = q.order('like_count', { ascending: false });
  return q.order('created_at', { ascending: false }).order('id', { ascending: false })
    .range(artworksOffset, artworksOffset + ARTWORKS_PAGE - 1);
}
async function loadMoreArtworks() {
  if (artworksLoading || artworksDone) return;
  artworksLoading = true;
  const run = artworksRun;
  updateArtworksMore();
  let { data, error } = await artworksPageQuery();
  // supabase_mosaic_like_count.sql / supabase_mosaic_pieces.sql not applied
  // yet: the error names the missing column — drop that one (not both) and
  // ask again, at most once per column.
  for (let tries = 0; tries < 2 && error && isSchemaMismatchError(error) && (artworksHasLikeCount || artworksHasPieces); tries++) {
    const msg = String(error.message || '');
    if (artworksHasPieces && (msg.includes('parent_id') || !artworksHasLikeCount)) artworksHasPieces = false;
    else artworksHasLikeCount = false;
    if (run !== artworksRun) return;
    ({ data, error } = await artworksPageQuery());
  }
  if (run !== artworksRun) return; // the visitor changed the search/sort meanwhile
  artworksLoading = false;
  if (error) {
    console.error('load artworks error:', error);
    toast(tr('couldNotLoadArtworks'));
    artworksDone = true;
    updateArtworksMore();
    return;
  }
  const rows = data || [];
  artworksOffset += rows.length;
  if (rows.length < ARTWORKS_PAGE) artworksDone = true;
  const grid = document.getElementById('artworksGrid');
  const visible = rows.filter(sub => !isUserBlocked(sub.author_id));
  visible.forEach((sub, i) => grid.appendChild(artworkCardEl(sub, i)));
  artworksShown += visible.length;
  document.getElementById('artworksEmpty').style.display = artworksShown ? 'none' : 'block';
  updateArtworksMore();
  // A page made only of blocked authors would leave the grid looking stuck.
  if (!visible.length && !artworksDone) loadMoreArtworks();
}
function updateArtworksMore() {
  document.getElementById('artworksMore').style.display = artworksDone ? 'none' : '';
  document.getElementById('artworksMoreBtn').disabled = artworksLoading;
}
function resetArtworks() {
  artworksRun++;
  artworksOffset = 0; artworksShown = 0; artworksDone = false; artworksLoading = false;
  document.getElementById('artworksGrid').innerHTML = '';
  document.getElementById('artworksEmpty').style.display = 'none';
  loadMoreArtworks();
}

// ---------- controls ----------
let artworksSearchTimer = null;
document.getElementById('artworkSearchInput').oninput = e => {
  clearTimeout(artworksSearchTimer);
  artworksSearchTimer = setTimeout(() => {
    const next = e.target.value.trim();
    if (next === artworksQuery) return;
    artworksQuery = next;
    resetArtworks();
  }, 300);
};
document.getElementById('artworkSortSelect').onchange = e => {
  artworksSort = e.target.value;
  resetArtworks();
};
document.getElementById('artworksMoreBtn').onclick = () => loadMoreArtworks();
// The next page also loads on its own as the visitor nears the bottom; the
// button stays as the visible affordance (and the fallback without
// IntersectionObserver).
if ('IntersectionObserver' in window) {
  new IntersectionObserver(entries => {
    if (entries.some(en => en.isIntersecting)) loadMoreArtworks();
  }, { rootMargin: '600px 0px' }).observe(document.getElementById('artworksMore'));
}

authReady.then(() => resetArtworks());
