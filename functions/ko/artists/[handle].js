import { pgFetchOne } from '../../_lib/supabase.js';
import { renderEntityPage, notFoundResponse } from '../../_lib/render.js';

const SITE = 'https://weavo.art';

export async function onRequestGet({ params, request, env }) {
  const handle = params.handle;
  let profile = await pgFetchOne(`profiles?username=ilike.${encodeURIComponent(handle)}&select=id,name,username,avatar_url,bio`);
  if (!profile) profile = await pgFetchOne(`profiles?id=eq.${encodeURIComponent(handle)}&select=id,name,username,avatar_url,bio`);

  const assetResponse = await env.ASSETS.fetch(new Request(new URL('/ko/profile', request.url), request));

  if (!profile) return notFoundResponse(assetResponse, '작가를 찾을 수 없습니다 | Weavo');

  if (profile.username && handle !== profile.username) {
    return Response.redirect(`${SITE}/ko/artists/${encodeURIComponent(profile.username)}`, 301);
  }

  const displayName = profile.username || profile.name || '익명';
  const canonical = `${SITE}/ko/artists/${encodeURIComponent(profile.username || profile.id)}`;
  const title = `${displayName} | Weavo`;
  const description = profile.bio ? profile.bio.slice(0, 300) : `Weavo의 작가 ${displayName}님의 프로필입니다.`;

  return renderEntityPage(assetResponse, {
    title, description, canonical,
    hreflangEn: `${SITE}/en/artists/${encodeURIComponent(profile.username || profile.id)}`,
    hreflangKo: canonical,
    image: profile.avatar_url,
    jsonld: [
      {
        '@context': 'https://schema.org', '@type': 'Person', name: displayName, url: canonical,
        ...(profile.avatar_url ? { image: profile.avatar_url } : {}),
        ...(profile.bio ? { description: profile.bio } : {}),
      },
      {
        '@context': 'https://schema.org', '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Weavo', item: `${SITE}/ko/` },
          { '@type': 'ListItem', position: 2, name: displayName, item: canonical },
        ],
      },
    ],
  });
}
