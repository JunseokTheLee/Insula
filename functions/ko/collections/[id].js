import { pgFetchOne } from '../../_lib/supabase.js';
import { renderEntityPage, notFoundResponse } from '../../_lib/render.js';

const SITE = 'https://weavo.art';

export async function onRequestGet({ params, request, env }) {
  const id = params.id;
  const collection = await pgFetchOne(
    `mosaic_collections?id=eq.${encodeURIComponent(id)}&select=id,title,description,owner_id&limit=1`
  );

  const assetResponse = await env.ASSETS.fetch(new Request(new URL('/ko/collection', request.url), request));

  if (!collection) return notFoundResponse(assetResponse, '컬렉션을 찾을 수 없습니다 | Weavo');

  const owner = await pgFetchOne(`profiles?id=eq.${encodeURIComponent(collection.owner_id)}&select=name,username&limit=1`);
  const ownerName = (owner && (owner.username || owner.name)) || '익명';

  const canonical = `${SITE}/ko/collections/${encodeURIComponent(collection.id)}`;
  const title = `${collection.title} | Weavo`;
  const description = collection.description
    ? collection.description.slice(0, 300)
    : `${ownerName}님이 Weavo에서 큐레이션한 컬렉션입니다.`;

  return renderEntityPage(assetResponse, {
    title, description, canonical,
    hreflangEn: `${SITE}/en/collections/${encodeURIComponent(collection.id)}`,
    hreflangKo: canonical,
    jsonld: [
      {
        '@context': 'https://schema.org', '@type': 'CollectionPage',
        name: collection.title, url: canonical,
        creator: { '@type': 'Person', name: ownerName, url: `${SITE}/ko/artists/${encodeURIComponent(collection.owner_id)}` },
        ...(collection.description ? { description: collection.description } : {}),
      },
      {
        '@context': 'https://schema.org', '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Weavo', item: `${SITE}/ko/` },
          { '@type': 'ListItem', position: 2, name: ownerName, item: `${SITE}/ko/artists/${encodeURIComponent(collection.owner_id)}` },
          { '@type': 'ListItem', position: 3, name: collection.title, item: canonical },
        ],
      },
    ],
  });
}
