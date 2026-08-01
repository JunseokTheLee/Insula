import { pgFetchMany } from './_lib/supabase.js';

const SITE = 'https://weavo.art';

// Only profiles with a username — that's the canonical /artists/{handle}
// slot; an account that hasn't set one yet has no stable public URL worth
// listing (it's still reachable and indexable via inbound links, just not
// sitemap-advertised).
export async function onRequestGet() {
  const profiles = await pgFetchMany('profiles?username=not.is.null&select=username&order=username.asc&limit=1000');

  const urls = profiles.flatMap(p => {
    const en = `${SITE}/en/artists/${encodeURIComponent(p.username)}`;
    const ko = `${SITE}/ko/artists/${encodeURIComponent(p.username)}`;
    return [en, ko].map(loc => `  <url>
    <loc>${loc}</loc>
    <xhtml:link rel="alternate" hreflang="en" href="${en}"/>
    <xhtml:link rel="alternate" hreflang="ko" href="${ko}"/>
  </url>`);
  });

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls.join('\n')}
</urlset>
`;
  return new Response(xml, { headers: { 'content-type': 'application/xml; charset=UTF-8', 'cache-control': 'public, max-age=3600' } });
}
