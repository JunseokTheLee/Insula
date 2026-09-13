import { pgFetchOne } from '../../_lib/supabase.js';
import { renderEntityPage, notFoundResponse } from '../../_lib/render.js';

const SITE = 'https://weavo.art';

export async function onRequestGet({ params, request, env }) {
  const id = params.id;
  const sub = await pgFetchOne(
    `mosaic_submissions?id=eq.${encodeURIComponent(id)}` +
    `&select=*&limit=1` // `*`: the piece columns of supabase_mosaic_pieces.sql may or may not exist yet
  );

  const assetResponse = await env.ASSETS.fetch(new Request(new URL('/en/artwork', request.url), request));

  if (!sub) return notFoundResponse(assetResponse, 'Artwork not found | Weavo');
  // A piece has no page of its own — its artwork does.
  if (sub.parent_id) return Response.redirect(`${SITE}/en/artworks/${encodeURIComponent(sub.parent_id)}`, 302);

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

  // A cut artwork's own project_id stays null — its campaign is its home campaign.
  // Read as its own row rather than as an embed: game_best_records points
  // at both mosaic_submissions and mosaic_projects, which made PostgREST
  // treat `mosaic_projects(...)` as ambiguous (PGRST201) and turned EVERY
  // artwork page into a 404 on 2026-09-13. A second FK anywhere would do
  // it again; a plain lookup cannot be made ambiguous.
  const projectId = sub.project_id || sub.home_project_id;
  const project = projectId
    ? await pgFetchOne(`mosaic_projects?id=eq.${encodeURIComponent(projectId)}&select=id,title`)
    : null;
  const jsonld = [{
    '@context': 'https://schema.org', '@type': 'VisualArtwork',
    name: sub.art_title || 'Untitled artwork', url: canonical, image: sub.image_url,
    creator: { '@type': 'Person', name, url: `${SITE}/en/artists/${encodeURIComponent(authorHandle)}` },
    ...(sub.art_description ? { description: sub.art_description } : {}),
    ...(project ? { isPartOf: { '@type': 'CreativeWork', name: project.title, url: `${SITE}/en/campaigns/${encodeURIComponent(project.id)}` } } : {}),
  }];

  return renderEntityPage(assetResponse, {
    title, description, canonical,
    hreflangEn: canonical,
    hreflangKo: `${SITE}/ko/artworks/${encodeURIComponent(sub.id)}`,
    image: sub.image_url,
    jsonld,
  });
}
