import { pgFetchOne } from '../../_lib/supabase.js';
import { renderEntityPage, notFoundResponse } from '../../_lib/render.js';

const SITE = 'https://weavo.art';

export async function onRequestGet({ params, request, env }) {
  const id = params.id;
  const project = await pgFetchOne(
    `mosaic_projects?id=eq.${encodeURIComponent(id)}&select=*&limit=1`
  );

  const assetResponse = await env.ASSETS.fetch(new Request(new URL('/en/campaign', request.url), request));

  if (!project) return notFoundResponse(assetResponse, 'Campaign not found | Weavo');

  const canonical = `${SITE}/en/campaigns/${encodeURIComponent(project.id)}`;
  const title = `${project.title} | Weavo`;
  const description = project.description
    ? project.description.slice(0, 300)
    : `A collaborative mosaic campaign on Weavo: ${project.title}.`;

  // A campaign's share card (made on create/reshape, common.js
  // previewImageBlob) is always 1200x630. Without one the template's own
  // site card stays, size tags and all.
  const shareCard = project.preview_image_url
    ? { image: project.preview_image_url, imageWidth: 1200, imageHeight: 630 }
    : {};

  return renderEntityPage(assetResponse, {
    title, description, canonical,
    hreflangEn: canonical,
    hreflangKo: `${SITE}/ko/campaigns/${encodeURIComponent(project.id)}`,
    ...shareCard,
    jsonld: [
      {
        '@context': 'https://schema.org', '@type': 'CreativeWork',
        name: project.title, url: canonical, image: project.preview_image_url || `${SITE}/og-image-en.png`,
        ...(project.description ? { description: project.description } : {}),
      },
      {
        '@context': 'https://schema.org', '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Weavo', item: `${SITE}/en/` },
          { '@type': 'ListItem', position: 2, name: 'Campaigns', item: `${SITE}/en/campaigns` },
          { '@type': 'ListItem', position: 3, name: project.title, item: canonical },
        ],
      },
    ],
  });
}
