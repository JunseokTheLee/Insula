import { pgFetchMany } from './_lib/supabase.js';

const SITE = 'https://weavo.art';

// Public portfolios only — listed in the directory (is_public AND
// is_published) and holding at least one artwork (`!inner` keeps the empty
// ones out). Link-only and private portfolios are not here: the first is
// reachable but noindex, the second is invisible to the anon key anyway.
export async function onRequestGet() {
  const rows = await pgFetchMany(
    'mosaic_collections?is_public=eq.true&is_published=eq.true'
    + '&select=id,created_at,published_at,mosaic_collection_items!inner(submission_id)'
    + '&order=published_at.desc.nullslast&limit=1000'
  );

  const urls = rows.flatMap(c => {
    const en = `${SITE}/en/portfolios/${encodeURIComponent(c.id)}`;
    const ko = `${SITE}/ko/portfolios/${encodeURIComponent(c.id)}`;
    const when = c.published_at || c.created_at;
    const lastmod = when ? `<lastmod>${new Date(when).toISOString()}</lastmod>` : '';
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
