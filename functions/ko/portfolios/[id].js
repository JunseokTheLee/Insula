import { pgFetchOne, pgFetchMany } from '../../_lib/supabase.js';
import { renderEntityPage, notFoundResponse } from '../../_lib/render.js';

const SITE = 'https://weavo.art';

// Portfolio detail (/ko/portfolios/{id}) — see functions/en/portfolios/[id].js.
export async function onRequestGet({ params, request, env }) {
  const id = params.id;
  const c = await pgFetchOne(`mosaic_collections?id=eq.${encodeURIComponent(id)}&select=*&limit=1`);

  const assetResponse = await env.ASSETS.fetch(new Request(new URL('/ko/portfolio', request.url), request));

  if (!c) return notFoundResponse(assetResponse, '포트폴리오를 찾을 수 없습니다 | Weavo');

  const owner = await pgFetchOne(`profiles?id=eq.${encodeURIComponent(c.owner_id)}&select=username,avatar_url&limit=1`);
  const ownerName = (owner && owner.username) || '익명';
  const ownerHandle = (owner && owner.username) || c.owner_id;

  const itemCols = 'submission_id,added_at,mosaic_submissions(id,art_title,image_url,thumb_url)';
  let items = await pgFetchMany(`mosaic_collection_items?collection_id=eq.${encodeURIComponent(id)}&select=${itemCols},position&order=position.asc.nullslast,added_at.desc&limit=200`);
  if (!items.length) items = await pgFetchMany(`mosaic_collection_items?collection_id=eq.${encodeURIComponent(id)}&select=${itemCols}&order=added_at.desc&limit=200`);
  const works = items.map(i => i.mosaic_submissions).filter(Boolean);
  const cover = works.find(w => w.id === c.cover_submission_id) || works[0] || null;
  const count = works.length;

  const canonical = `${SITE}/ko/portfolios/${encodeURIComponent(c.id)}`;
  const title = `${c.title} — ${ownerName} | Weavo`;
  const description = c.description
    ? c.description.slice(0, 300)
    : `${ownerName}님의 포트폴리오 · 작품 ${count}점 — Weavo`;
  const shareCard = c.preview_image_url
    ? { image: c.preview_image_url, imageWidth: 1200, imageHeight: 630 }
    : (cover ? { image: cover.image_url } : {});

  const jsonld = [
    {
      '@context': 'https://schema.org', '@type': 'CollectionPage',
      name: c.title, url: canonical,
      creator: { '@type': 'Person', name: ownerName, url: `${SITE}/ko/artists/${encodeURIComponent(ownerHandle)}` },
      ...(c.description ? { description: c.description } : {}),
      ...(cover ? { image: c.preview_image_url || cover.image_url } : {}),
      ...(works.length ? {
        hasPart: works.slice(0, 12).map(w => ({
          '@type': 'VisualArtwork', name: w.art_title || '제목 없는 작품',
          url: `${SITE}/ko/artworks/${encodeURIComponent(w.id)}`, image: w.image_url,
        })),
      } : {}),
    },
    {
      '@context': 'https://schema.org', '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Weavo', item: `${SITE}/ko/` },
        { '@type': 'ListItem', position: 2, name: '포트폴리오', item: `${SITE}/ko/portfolios` },
        { '@type': 'ListItem', position: 3, name: ownerName, item: `${SITE}/ko/artists/${encodeURIComponent(ownerHandle)}` },
        { '@type': 'ListItem', position: 4, name: c.title, item: canonical },
      ],
    },
  ];

  return renderEntityPage(assetResponse, {
    title, description, canonical,
    hreflangEn: `${SITE}/en/portfolios/${encodeURIComponent(c.id)}`,
    hreflangKo: canonical,
    ...shareCard,
    locale: 'ko_KR',
    noindex: !c.is_published,
    jsonld,
  });
}
