// All Artists directory page: every profile with a completed username, with
// a client-side name/username search filter.
// Needs js/common.js for fetchAllRows/isUserBlocked/toast loaded first.
"use strict";

let allArtists = [];

function artistDisplayName(p) { return p.username || tr('anonymous'); }

function artistCardHtml(p) {
  const name = artistDisplayName(p);
  const avatar = p.avatar_url
    ? `<img class="artist-card-avatar" src="${cdnUrl(p.avatar_url)}" alt="">`
    : `<div class="artist-card-avatar artist-card-avatar-fallback">${escapeHtml(name.charAt(0).toUpperCase())}</div>`;
  return `
    <a class="artist-card" href="${profileUrl(p.username || p.id)}">
      ${avatar}
      <div class="artist-card-name">${escapeHtml(name)}</div>
      ${p.bio ? `<div class="artist-card-bio">${escapeHtml(p.bio)}</div>` : ''}
    </a>`;
}

function renderArtists(list) {
  document.getElementById('artistsGrid').innerHTML = list.map(artistCardHtml).join('');
  document.getElementById('artistsEmpty').style.display = list.length ? 'none' : 'block';
}

function filterArtists(query) {
  const q = query.trim().toLowerCase();
  if (!q) return allArtists;
  return allArtists.filter(p => {
    const username = (p.username || '').toLowerCase();
    return username.includes(q);
  });
}

async function loadArtists() {
  // Only profiles that finished onboarding (username is mandatory to
  // complete account setup — see maybeRequireProfileSetup in auth.js) show
  // up here, same filter the [handle].js Function relies on to treat
  // username as a real, canonical handle.
  // fetchAllRows because PostgREST stops at 1,000 rows WITHOUT an error:
  // past a thousand members the later ones would simply stop appearing here
  // and nobody would see a failure (CLAUDE.md 7). Ordered by username, which
  // is case-insensitively unique (supabase_profiles.sql) — a unique sort key
  // is what keeps rows from repeating or vanishing across page boundaries,
  // and it is the order this page wants anyway.
  // Artists only (supabase_member_type.sql, 2026-10-07): members who only
  // look, like and play are not listed here — they are still reachable from
  // the network, comments and follow lists. Without the column (SQL not
  // applied) everyone is listed as before.
  const query = artistsOnly => fetchAllRows(
    () => {
      const b = sb.from('profiles')
        .select('id,username,avatar_url,bio', { count: 'exact' })
        .not('username', 'is', null);
      return artistsOnly ? b.eq('member_type', 'artist') : b;
    },
    { orderBy: 'username' }
  );
  let { data, error } = await query(true);
  if (error && isSchemaMismatchError(error)) ({ data, error } = await query(false));
  if (error) { console.error('load artists error:', error); toast(tr('couldNotLoadArtists')); return; }
  allArtists = (data || []).filter(p => !isUserBlocked(p.id));
  renderArtists(filterArtists(document.getElementById('artistSearchInput').value));
}

document.getElementById('artistSearchInput').oninput = e => renderArtists(filterArtists(e.target.value));

authReady.then(() => loadArtists());
