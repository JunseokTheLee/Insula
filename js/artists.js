// All Artists directory page: every profile with a completed username, with
// a client-side name/username search filter.
"use strict";

let allArtists = [];

function artistDisplayName(p) { return p.username || p.name || tr('anonymous'); }

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
    const name = (p.name || '').toLowerCase();
    return username.includes(q) || name.includes(q);
  });
}

async function loadArtists() {
  // Only profiles that finished onboarding (username is mandatory to
  // complete account setup — see maybeRequireProfileSetup in auth.js) show
  // up here, same filter the [handle].js Function relies on to treat
  // username as a real, canonical handle.
  const { data, error } = await sb.from('profiles')
    .select('id,name,username,avatar_url,bio')
    .not('username', 'is', null)
    .order('username', { ascending: true });
  if (error) { console.error('load artists error:', error); toast(tr('couldNotLoadArtists')); return; }
  allArtists = data || [];
  renderArtists(filterArtists(document.getElementById('artistSearchInput').value));
}

document.getElementById('artistSearchInput').oninput = e => renderArtists(filterArtists(e.target.value));

authReady.then(() => loadArtists());
