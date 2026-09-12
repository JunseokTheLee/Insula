// Standalone artwork page (/{lang}/artworks/{id}) — the same piece a
// project/profile page's lightbox shows inline, but at its own real,
// shareable, indexable URL. Reuses lightbox.js's populateLightboxContent()
// for the actual content (image, artist card, description, likes/follows,
// comments) since this page embeds that same markup directly in the page
// body instead of inside a modal. Needs sb, me, tr, common.js and
// lightbox.js already loaded.
"use strict";

async function fetchArtwork(id) {
  const base = 'id,pixel_id,project_id,image_url,thumb_url,art_title,art_material,art_completed_date,art_description,art_link,author_id,author_name,author_avatar_url,created_at,mosaic_projects(id,title)';
  // Piece columns (supabase_mosaic_pieces.sql) asked for first, dropped
  // while that file isn't applied.
  let { data, error } = await sb.from('mosaic_submissions').select(base + ',parent_id,piece_n,home_project_id').eq('id', id).maybeSingle();
  if (error && isSchemaMismatchError(error)) ({ data, error } = await sb.from('mosaic_submissions').select(base).eq('id', id).maybeSingle());
  if (error) { console.error('load artwork error:', error); return null; }
  // A cut artwork's campaign is its home campaign (its pieces are placed
  // there); the row's own project_id stays null.
  if (data && !data.mosaic_projects && data.home_project_id) {
    const { data: p } = await sb.from('mosaic_projects').select('id,title').eq('id', data.home_project_id).maybeSingle();
    if (p) data.mosaic_projects = p;
  }
  return data;
}

function updateArtworkMeta(sub) {
  const name = sub.author_name || tr('anonymous');
  const title = sub.art_title ? `${sub.art_title} — ${name} | Weavo` : `${name} | Weavo`;
  const description = sub.art_description
    ? sub.art_description.slice(0, 300)
    : (CURRENT_LANG === 'ko' ? `${name}님이 Weavo에 제출한 작품입니다.` : `Artwork submitted to Weavo by ${name}.`);
  updatePageMeta({ title, description, canonical: `${location.origin}${artworkUrl(sub.id)}`, image: sub.image_url });
}

function renderArtworkJsonLd(sub) {
  const name = sub.author_name || tr('anonymous');
  const project = sub.mosaic_projects;
  const data = {
    '@context': 'https://schema.org',
    '@type': 'VisualArtwork',
    name: sub.art_title || (CURRENT_LANG === 'ko' ? '제목 없는 작품' : 'Untitled artwork'),
    url: `${location.origin}${artworkUrl(sub.id)}`,
    image: sub.image_url,
    creator: { '@type': 'Person', name, url: `${location.origin}${profileUrl(sub.author_id)}` },
  };
  if (sub.art_description) data.description = sub.art_description;
  if (sub.art_material) data.artMedium = sub.art_material;
  if (sub.art_completed_date) data.dateCreated = artDateToYear(sub.art_completed_date);
  if (project) data.isPartOf = { '@type': 'CreativeWork', name: project.title, url: `${location.origin}${projectUrl(project.id)}` };
  injectJsonLd([data]);
}

function renderArtworkBreadcrumb(sub) {
  const wrap = document.getElementById('artworkBreadcrumb');
  const link = document.getElementById('artworkProjectLink');
  if (sub.mosaic_projects) {
    link.textContent = sub.mosaic_projects.title;
    link.href = projectUrl(sub.mosaic_projects.id);
  } else {
    wrap.style.display = 'none';
  }
}

async function loadArtworkPage(id) {
  const sub = await fetchArtwork(id);
  if (!sub) {
    document.getElementById('lightbox-cap-title').textContent = tr('artworkNotFound');
    document.getElementById('artworkBreadcrumb').style.display = 'none';
    return;
  }
  // A piece has no page of its own — its artwork does.
  if (sub.parent_id) { location.replace(artworkUrl(sub.parent_id)); return; }
  const backBtn = document.getElementById('artworkBackBtn');
  const campaignId = sub.project_id || sub.home_project_id;
  // Where "back" goes for someone who arrived from outside the site; a
  // visitor who came from another Weavo page goes back to that page instead
  // (common.js setupBackLink).
  backBtn.href = campaignId ? projectUrl(campaignId) : `/${CURRENT_LANG}/campaigns`;
  setupBackLink(backBtn);
  renderArtworkBreadcrumb(sub);
  populateLightboxContent(sub); // also renders the piece usage line (lightbox.js)
  updateArtworkMeta(sub);
  renderArtworkJsonLd(sub);
  // Set once the actual image dimensions are known, to give the browser a
  // real intrinsic size up front (reduces layout shift) — the markup's
  // placeholder width/height only hold the aspect ratio until this fires.
  const img = document.getElementById('lightbox-img');
  img.addEventListener('load', () => {
    if (img.naturalWidth) { img.width = img.naturalWidth; img.height = img.naturalHeight; }
  }, { once: true });
}

// After a delete, there's nothing left on this page to show — leave for
// the artwork's project if it still exists, else the projects list.
window.onSubmissionDeleted = sub => { location.href = sub && sub.project_id ? projectUrl(sub.project_id) : `/${CURRENT_LANG}/campaigns`; };

// The lightbox already re-rendered the visible caption in place — just
// refresh the <title>/meta tags and JSON-LD off the edited details.
window.onSubmissionUpdated = sub => {
  updateArtworkMeta(sub);
  renderArtworkJsonLd(sub);
};

authReady.then(async () => {
  const id = routeParam('artworks', 'id');
  if (!id) { document.getElementById('lightbox-cap-title').textContent = tr('artworkNotFound'); return; }
  await loadArtworkPage(id);
});
