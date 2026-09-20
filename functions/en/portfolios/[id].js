import { pgFetchOne, pgFetchMany } from '../../_lib/supabase.js';
import { renderEntityPage, notFoundResponse } from '../../_lib/render.js';

const SITE = 'https://weavo.art';

// Portfolio detail (/en/portfolios/{id}): the <head> a social app or a
// crawler sees. The anon key this runs under is subject to RLS, so a
// private portfolio simply does not come back and 404s; a link-only one
// renders but is marked noindex (reachable, not listed). `select=*` so the
// columns of supabase_portfolios.sql may or may not exist yet.
export async function onRequestGet({ params, request, env }) {
  const id = params.id;
  const c = await pgFetchOne(`mosaic_collections?id=eq.${encodeURIComponent(id)}&select=*&limit=1`);

  const assetResponse = await env.ASSETS.fetch(new Request(new URL('/en/portfolio', request.url), request));

  if (!c) return notFoundResponse(assetResponse, 'Portfolio not found | Weavo');

  const owner = await pgFetchOne(`profiles?id=eq.${encodeURIComponent(c.owner_id)}&select=username,avatar_url&limit=1`);
  const ownerName = (owner && owner.username) || 'Anonymous';
  const ownerHandle = (owner && owner.username) || c.owner_id;

  // The artworks in the owner's order; asked again without `position`
  // while supabase_portfolios.sql is not applied (unknown column → 400 → []).
  const itemCols = 'submission_id,added_at,mosaic_submissions(id,art_title,image_url,thumb_url)';
  let items = await pgFetchMany(`mosaic_collection_items?collection_id=eq.${encodeURIComponent(id)}&select=${itemCols},position&order=position.asc.nullslast,added_at.desc&limit=200`);
  if (!items.length) items = await pgFetchMany(`mosaic_collection_items?collection_id=eq.${encodeURIComponent(id)}&select=${itemCols}&order=added_at.desc&limit=200`);
  const works = items.map(i => i.mosaic_submissions).filter(Boolean);
  const cover = works.find(w => w.id === c.cover_submission_id) || works[0] || null;
  const count = works.length;

  const canonical = `${SITE}/en/portfolios/${encodeURIComponent(c.id)}`;
  const title = `${c.title} — ${ownerName} | Weavo`;
  const description = c.description
    ? c.description.slice(0, 300)
    : `A portfolio by ${ownerName} on Weavo · ${count} ${count === 1 ? 'work' : 'works'}.`;
  // The share card (1200×630, rendered by the owner's browser) when there is
  // one, else the cover picture at whatever size it is, else the site card.
  const shareCard = c.preview_image_url
    ? { image: c.preview_image_url, imageWidth: 1200, imageHeight: 630 }
    : (cover ? { image: cover.image_url } : {});

  const jsonld = [
    {
      '@context': 'https://schema.org', '@type': 'CollectionPage',
      name: c.title, url: canonical,
      creator: { '@type': 'Person', name: ownerName, url: `${SITE}/en/artists/${encodeURIComponent(ownerHandle)}` },
      ...(c.description ? { description: c.description } : {}),
      ...(cover ? { image: c.preview_image_url || cover.image_url } : {}),
      ...(works.length ? {
        hasPart: works.slice(0, 12).map(w => ({
          '@type': 'VisualArtwork', name: w.art_title || 'Untitled artwork',
          url: `${SITE}/en/artworks/${encodeURIComponent(w.id)}`, image: w.image_url,
        })),
      } : {}),
    },
    {
      '@context': 'https://schema.org', '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Weavo', item: `${SITE}/en/` },
        { '@type': 'ListItem', position: 2, name: 'Portfolios', item: `${SITE}/en/portfolios` },
        { '@type': 'ListItem', position: 3, name: ownerName, item: `${SITE}/en/artists/${encodeURIComponent(ownerHandle)}` },
        { '@type': 'ListItem', position: 4, name: c.title, item: canonical },
      ],
    },
  ];

  return renderEntityPage(assetResponse, {
    title, description, canonical,
    hreflangEn: canonical,
    hreflangKo: `${SITE}/ko/portfolios/${encodeURIComponent(c.id)}`,
    ...shareCard,
    noindex: !c.is_published,
    jsonld,
  });
}
