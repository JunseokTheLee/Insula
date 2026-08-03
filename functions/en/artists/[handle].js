import { pgFetchOne } from '../../_lib/supabase.js';
import { renderEntityPage, notFoundResponse } from '../../_lib/render.js';

const SITE = 'https://weavo.art';

export async function onRequestGet({ params, request, env }) {
  const handle = params.handle;
  // Accepts either a username (the canonical, shareable form) or a raw user
  // id (links built from a submission/comment's author_id before a username
  // existed) — try username first, case-insensitively, then fall back to id.
  let profile = await pgFetchOne(`profiles?username=ilike.${encodeURIComponent(handle)}&select=id,name,username,avatar_url,bio`);
  if (!profile) profile = await pgFetchOne(`profiles?id=eq.${encodeURIComponent(handle)}&select=id,name,username,avatar_url,bio`);

  const assetResponse = await env.ASSETS.fetch(new Request(new URL('/en/profile', request.url), request));

  if (!profile) return notFoundResponse(assetResponse, 'Artist not found | Weavo');

  // Canonicalize a raw-id request to the username URL once one exists, same
  // as the client-side history.replaceState() in profile-view.js — a real
  // 301 here means search engines consolidate straight onto the vanity URL.
  // Built off the request's own origin (not the hardcoded SITE constant)
  // so this still redirects within localhost/preview during dev instead of
  // bouncing out to production.
  if (profile.username && handle !== profile.username) {
    return Response.redirect(`${new URL(request.url).origin}/en/artists/${encodeURIComponent(profile.username)}`, 301);
  }

  const displayName = profile.username || profile.name || 'Anonymous';
  const canonical = `${SITE}/en/artists/${encodeURIComponent(profile.username || profile.id)}`;
  const title = `${displayName} | Weavo`;
  const description = profile.bio ? profile.bio.slice(0, 300) : `${displayName}'s artist profile on Weavo.`;

  return renderEntityPage(assetResponse, {
    title, description, canonical,
    hreflangEn: canonical,
    hreflangKo: `${SITE}/ko/artists/${encodeURIComponent(profile.username || profile.id)}`,
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
          { '@type': 'ListItem', position: 1, name: 'Weavo', item: `${SITE}/en/` },
          { '@type': 'ListItem', position: 2, name: displayName, item: canonical },
        ],
      },
    ],
  });
}
