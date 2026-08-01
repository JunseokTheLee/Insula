import { pgFetchOne } from '../../_lib/supabase.js';
import { renderEntityPage, notFoundResponse } from '../../_lib/render.js';

const SITE = 'https://weavo.art';

export async function onRequestGet({ params, request, env }) {
  const id = params.id;
  const project = await pgFetchOne(
    `mosaic_projects?id=eq.${encodeURIComponent(id)}&select=id,title,description,reference_image_url&limit=1`
  );

  const assetResponse = await env.ASSETS.fetch(new Request(new URL('/ko/project', request.url), request));

  if (!project) return notFoundResponse(assetResponse, '프로젝트를 찾을 수 없습니다 | Weavo');

  const canonical = `${SITE}/ko/projects/${encodeURIComponent(project.id)}`;
  const title = `${project.title} | Weavo`;
  const description = project.description
    ? project.description.slice(0, 300)
    : `Weavo의 공동 모자이크 프로젝트: ${project.title}.`;

  return renderEntityPage(assetResponse, {
    title, description, canonical,
    hreflangEn: `${SITE}/en/projects/${encodeURIComponent(project.id)}`,
    hreflangKo: canonical,
    image: project.reference_image_url,
    jsonld: [
      {
        '@context': 'https://schema.org', '@type': 'CreativeWork',
        name: project.title, url: canonical, image: project.reference_image_url,
        ...(project.description ? { description: project.description } : {}),
      },
      {
        '@context': 'https://schema.org', '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Weavo', item: `${SITE}/ko/` },
          { '@type': 'ListItem', position: 2, name: '프로젝트', item: `${SITE}/ko/projects` },
          { '@type': 'ListItem', position: 3, name: project.title, item: canonical },
        ],
      },
    ],
  });
}
