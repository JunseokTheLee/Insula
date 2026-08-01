import { pgFetchOne } from '../../_lib/supabase.js';
import { renderEntityPage, notFoundResponse } from '../../_lib/render.js';

const SITE = 'https://weavo.art';

export async function onRequestGet({ params, request, env }) {
  const id = params.id;
  const sub = await pgFetchOne(
    `mosaic_submissions?id=eq.${encodeURIComponent(id)}` +
    `&select=id,art_title,art_description,image_url,author_id,author_name,project_id,mosaic_projects(id,title)&limit=1`
  );

  const assetResponse = await env.ASSETS.fetch(new Request(new URL('/en/artwork', request.url), request));

  if (!sub) return notFoundResponse(assetResponse, 'Artwork not found | Weavo');

  // Prefer the artist's username for the creator link, same as the client's
  // own canonicalization in profile-view.js — falls back to the raw id if
  // they haven't set one.
  const author = sub.author_id ? await pgFetchOne(`profiles?id=eq.${encodeURIComponent(sub.author_id)}&select=username`) : null;
  const authorHandle = (author && author.username) || sub.author_id;
  const name = sub.author_name || 'Anonymous';

  const canonical = `${SITE}/en/artworks/${encodeURIComponent(sub.id)}`;
  const title = sub.art_title ? `${sub.art_title} — ${name} | Weavo` : `${name} | Weavo`;
  const description = sub.art_description
    ? sub.art_description.slice(0, 300)
    : `Artwork submitted to Weavo by ${name}.`;

  const project = sub.mosaic_projects;
  const jsonld = [{
    '@context': 'https://schema.org', '@type': 'VisualArtwork',
    name: sub.art_title || 'Untitled artwork', url: canonical, image: sub.image_url,
    creator: { '@type': 'Person', name, url: `${SITE}/en/artists/${encodeURIComponent(authorHandle)}` },
    ...(sub.art_description ? { description: sub.art_description } : {}),
    ...(project ? { isPartOf: { '@type': 'CreativeWork', name: project.title, url: `${SITE}/en/projects/${encodeURIComponent(project.id)}` } } : {}),
  }];

  return renderEntityPage(assetResponse, {
    title, description, canonical,
    hreflangEn: canonical,
    hreflangKo: `${SITE}/ko/artworks/${encodeURIComponent(sub.id)}`,
    image: sub.image_url,
    jsonld,
  });
}
