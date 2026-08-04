import { pgFetchMany } from './_lib/supabase.js';

const SITE = 'https://weavo.art';

// Only public collections — a private board's URL still works for its
// owner, it just isn't sitemap-listed or (per mosaic_collections' RLS)
// visible to the anon key this runs under in the first place.
export async function onRequestGet() {
  const collections = await pgFetchMany('mosaic_collections?is_public=eq.true&select=id,created_at&order=created_at.desc&limit=1000');

  const urls = collections.flatMap(c => {
    const en = `${SITE}/en/collections/${encodeURIComponent(c.id)}`;
    const ko = `${SITE}/ko/collections/${encodeURIComponent(c.id)}`;
    const lastmod = c.created_at ? `<lastmod>${new Date(c.created_at).toISOString()}</lastmod>` : '';
    return [en, ko].map(loc => `  <url>
    <loc>${loc}</loc>
    ${lastmod}
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
