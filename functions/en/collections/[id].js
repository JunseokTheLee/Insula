import { pgFetchOne } from '../../_lib/supabase.js';
import { renderEntityPage, notFoundResponse } from '../../_lib/render.js';

const SITE = 'https://weavo.art';

export async function onRequestGet({ params, request, env }) {
  const id = params.id;
  // A private collection simply doesn't come back here — the anon key this
  // runs under is subject to the same RLS as the browser client, so a
  // private board's row is invisible without needing an explicit is_public
  // check, and correctly 404s instead of leaking a social-preview card.
  const collection = await pgFetchOne(
    `mosaic_collections?id=eq.${encodeURIComponent(id)}&select=id,title,description,owner_id&limit=1`
  );

  const assetResponse = await env.ASSETS.fetch(new Request(new URL('/en/collection', request.url), request));

  if (!collection) return notFoundResponse(assetResponse, 'Exhibition not found | Weavo');

  const owner = await pgFetchOne(`profiles?id=eq.${encodeURIComponent(collection.owner_id)}&select=name,username&limit=1`);
  const ownerName = (owner && (owner.username || owner.name)) || 'Anonymous';

  const canonical = `${SITE}/en/collections/${encodeURIComponent(collection.id)}`;
  const title = `${collection.title} | Weavo`;
  const description = collection.description
    ? collection.description.slice(0, 300)
    : `A mini-exhibition curated by ${ownerName} on Weavo.`;

  return renderEntityPage(assetResponse, {
    title, description, canonical,
    hreflangEn: canonical,
    hreflangKo: `${SITE}/ko/collections/${encodeURIComponent(collection.id)}`,
    jsonld: [
      {
        '@context': 'https://schema.org', '@type': 'CollectionPage',
        name: collection.title, url: canonical,
        creator: { '@type': 'Person', name: ownerName, url: `${SITE}/en/artists/${encodeURIComponent(collection.owner_id)}` },
        ...(collection.description ? { description: collection.description } : {}),
      },
      {
        '@context': 'https://schema.org', '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Weavo', item: `${SITE}/en/` },
          { '@type': 'ListItem', position: 2, name: ownerName, item: `${SITE}/en/artists/${encodeURIComponent(collection.owner_id)}` },
          { '@type': 'ListItem', position: 3, name: collection.title, item: canonical },
        ],
      },
    ],
  });
}
