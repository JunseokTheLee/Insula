// Landing page: hero (copy, campaign mosaic, pieces progress),
// stats bar, and the latest-artworks list below the hero.
// Needs js/project-preview.js (paintProjectPreview) loaded first.
"use strict";

// The hero shows one active campaign at a time — the newest first — and the
// ‹ › buttons step through the others; every number on the page (pieces,
// percent, the caption) follows the campaign on screen. Everything here is
// counted in PIECES. The donation/pledge figures the hero used to show were
// removed on 2026-09-12, and the columns behind them were dropped the same
// day (supabase_mosaic_sponsor_drop.sql) — no screen, form or column in
// this site refers to money any more.
let heroProjects = [];
let heroIndex = 0;
async function loadHeroPreview() {
  const { data: projects, error } = await sb.from('mosaic_projects')
    .select('*')
    .eq('is_archived', false)
    .order('created_at', { ascending: false });
  if (error) { console.error('load projects error:', error); return; }
  heroProjects = projects || [];
  heroIndex = 0;
  renderHeroPreview();
}
async function renderHeroPreview() {
  weavoMark('home:hero');
  const canvas = document.getElementById('heroPreviewCanvas');
  const emptyEl = document.getElementById('heroPreviewEmpty');
  const link = document.getElementById('heroPreview');
  const featured = heroProjects[heroIndex];
  document.getElementById('heroArtNav').style.display = heroProjects.length > 1 ? '' : 'none';
  if (!featured) {
    canvas.style.display = 'none';
    emptyEl.style.display = '';
    renderHeroProgress(0, 0);
    renderHeroMine(new Map(), 0);
    renderHeroStrip(new Map(), null);
    return;
  }
  canvas.style.display = '';
  emptyEl.style.display = 'none';
  link.href = projectUrl(featured.id);
  document.getElementById('heroCampaignLink').href = projectUrl(featured.id);
  try {
    // Painted off-screen first (paintProjectPreview is shared with the
    // campaign cards) so a slow load can't overwrite the canvas after the
    // visitor has already stepped on to another campaign.
    const off = document.createElement('canvas');
    await paintProjectPreview({ querySelector: sel => (sel === 'canvas' ? off : null) }, featured);
    // The counts come straight from the shared grid cache rather than from
    // paintProjectPreview's return value: a browser that kept a stale copy
    // of project-preview.js (without that return) showed every number as 0
    // on 2026-09-10, while the mosaic itself painted fine.
    const { cells, filled } = await getCachedProjectGrid(featured);
    if (heroProjects[heroIndex] !== featured) return;
    canvas.width = off.width;
    canvas.height = off.height;
    canvas.getContext('2d').drawImage(off, 0, 0);
    let filledCount = 0;
    for (const c of cells) if (filled.has(`${c.x},${c.y}`)) filledCount++;
    renderHeroProgress(filledCount, cells.length);
    renderHeroMine(filled, cells.length);
    renderHeroStrip(filled, featured).catch(e => console.error('hero strip error:', e));
  } catch (e) {
    console.error('hero preview error:', e);
  }
}
// "My pieces": how many of the campaign on screen's filled cells hold a
// piece of the signed-in visitor's own work, and what share of the whole
// mosaic that is. Hidden while signed out; re-evaluated when the session
// changes (auth.js dispatches weavo:authchange).
let heroMineFilled = null;
let heroMineTotal = 0;
function renderHeroMine(filled, total) {
  heroMineFilled = filled; heroMineTotal = total;
  const box = document.getElementById('heroMine');
  if (!me.id) { box.style.display = 'none'; return; }
  // Pieces, and the artworks they were cut from: 49 pieces of one painting
  // is one artwork, not 49. A piece points at its artwork through parent_id;
  // a row placed whole (from before pieces existed) stands for itself.
  let mine = 0;
  const myWorks = new Set();
  for (const sub of filled.values()) {
    if (sub.author_id !== me.id) continue;
    mine++;
    myWorks.add(sub.parent_id != null ? `p${sub.parent_id}` : `s${sub.id}`);
  }
  const fmt = n => n.toLocaleString(CURRENT_LANG === 'ko' ? 'ko-KR' : 'en-US');
  const pct = total ? (mine / total) * 100 : 0;
  // One piece of a 5,000-cell mosaic is 0.02% — a single decimal would
  // round a real contribution down to "0.0%", so go finer below 0.1%.
  // Separate keys rather than a plural rule: tr() has no pluralisation, and
  // Korean needs none (both keys are the same string there).
  const works = tr(myWorks.size === 1 ? 'heroMineWork' : 'heroMineWorks', { n: fmt(myWorks.size) });
  const pieces = tr(mine === 1 ? 'heroMinePiece' : 'heroMinePieces', { n: fmt(mine) });
  document.getElementById('heroMineValue').textContent = tr('heroMineSummary', { works, pieces });
  document.getElementById('heroMinePercent').textContent = `${pct > 0 && pct < 0.1 ? pct.toFixed(2) : pct.toFixed(1)}%`;
  box.style.display = '';
}
document.addEventListener('weavo:authchange', () => { if (heroMineFilled) renderHeroMine(heroMineFilled, heroMineTotal); });

// ---------- the artworks behind the mosaic on screen ----------
// One horizontal strip of thumbnails under the hero. The filled cells hold
// PIECES, so the distinct artworks are their parent_id's — fetched once per
// campaign and cached, since the arrows come back to the same campaigns.
// Batched at 200 ids like fetchPieceParents (project.js); a 10,000-cell
// campaign cut 7x7 cannot hold more than ~204 artworks, so this is one
// request in practice.
const heroStripCache = new Map();
let heroStripRun = 0;
function heroArtworkIds(filled) {
  const ids = new Set();
  for (const sub of filled.values()) {
    const id = sub.parent_id != null ? sub.parent_id : sub.id;
    if (id != null) ids.add(id);
  }
  return [...ids];
}
function fetchHeroArtworks(projectId, ids) {
  if (!heroStripCache.has(projectId)) {
    heroStripCache.set(projectId, (async () => {
      const out = [];
      for (let i = 0; i < ids.length; i += 200) {
        const { data, error } = await sb.from('mosaic_submissions')
          .select('id,art_title,thumb_url,image_url,author_name,created_at')
          .in('id', ids.slice(i, i + 200));
        if (error) { console.error('load hero artworks error:', error); break; }
        out.push(...(data || []));
      }
      // Newest first — the order the rest of the site lists artwork in.
      out.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      return out;
    })());
  }
  return heroStripCache.get(projectId);
}
async function renderHeroStrip(filled, project) {
  const box = document.getElementById('heroStrip');
  const track = document.getElementById('heroStripTrack');
  if (!box || !track) return; // page HTML from before this strip existed
  const run = ++heroStripRun;
  const ids = project ? heroArtworkIds(filled) : [];
  if (!ids.length) { box.style.display = 'none'; track.innerHTML = ''; return; }

  const works = await fetchHeroArtworks(project.id, ids);
  if (run !== heroStripRun) return; // stepped to another campaign meanwhile
  track.innerHTML = '';
  for (const w of works) {
    const a = document.createElement('a');
    a.className = 'hero-strip-item';
    a.href = artworkUrl(w.id);
    const name = w.author_name || tr('anonymous');
    const img = document.createElement('img');
    img.className = 'hero-strip-img'; img.loading = 'lazy';
    img.src = cdnUrl(w.thumb_url || w.image_url);
    img.alt = w.art_title ? tr('artworkThumbAlt', { title: w.art_title, name }) : tr('artworkImgAltFallback', { name });
    const title = document.createElement('div');
    title.className = 'hero-strip-title'; title.textContent = w.art_title || tr('untitledArtwork');
    const by = document.createElement('div');
    by.className = 'hero-strip-by'; by.textContent = name;
    a.append(img, title, by);
    // Was a plain link to the artwork page, and that page had been 404ing
    // since the game tables were added (an ambiguous PostgREST embed) — so
    // clicking a piece of the mosaic showed nothing at all. The lightbox is
    // also what the rest of the site's artwork grids do.
    bindArtworkLightbox(a, w.id);
    track.appendChild(a);
  }
  const countEl = document.getElementById('heroStripCount');
  if (countEl) countEl.textContent = works.length.toLocaleString(CURRENT_LANG === 'ko' ? 'ko-KR' : 'en-US');
  track.scrollLeft = 0;
  box.style.display = works.length ? '' : 'none';
}
function heroStep(delta) {
  if (heroProjects.length < 2) return;
  heroIndex = (heroIndex + delta + heroProjects.length) % heroProjects.length;
  renderHeroPreview();
}
document.getElementById('heroPrev').onclick = () => heroStep(-1);
document.getElementById('heroNext').onclick = () => heroStep(1);
// Pieces and percent for the campaign on screen.
function renderHeroProgress(filled, total) {
  const share = total ? filled / total : 0;
  const fmt = n => n.toLocaleString(CURRENT_LANG === 'ko' ? 'ko-KR' : 'en-US');
  const set = (id, v) => { document.getElementById(id).textContent = v; };
  set('heroPieces', fmt(filled));
  set('heroPiecesTotal', fmt(total));
  set('heroAdded', fmt(filled));
  set('heroRemaining', fmt(Math.max(0, total - filled)));
  set('heroTotalInline', fmt(total));
  set('heroTotalCaption', fmt(total));
  set('heroPercent', `${(share * 100).toFixed(1)}%`);
  document.getElementById('heroProgressFill').style.width = `${Math.round(share * 1000) / 10}%`;
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
  // Pieces (supabase_mosaic_pieces.sql) are not artworks; asked again
  // without the filter while that file isn't applied (unknown column).
  // Public artworks only (supabase_portfolios.sql): RLS already hides other
  // people's private ones, the filter keeps the artist's own out as well.
  const q = (artworksOnly, publicOnly) => {
    let s = sb.from('mosaic_submissions')
      .select('id,pixel_id,project_id,image_url,thumb_url,art_title,art_material,art_completed_date,art_description,art_link,author_id,author_name,author_avatar_url,created_at');
    if (artworksOnly) s = s.is('parent_id', null);
    if (publicOnly) s = s.eq('is_public', true);
    return s.order('created_at', { ascending: false }).limit(30);
  };
  let { data, error } = typeof queryWithOptional === 'function'
    ? await queryWithOptional(on => q(on.has('pieces'), on.has('visibility')), { pieces: ['parent_id'], visibility: ['is_public'] })
    : await q(true, false);
  if (error && isSchemaMismatchError(error)) ({ data, error } = await q(false, false));
  if (error) { console.error('load recent artworks error:', error); toast(tr('couldNotLoadArtworks')); return; }
  renderRecentArtworks((data || []).filter(sub => !isUserBlocked(sub.author_id)).slice(0, 5));
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

authReady.then(() => { loadHeroPreview(); renderStats(); loadRecentArtworks(); });
