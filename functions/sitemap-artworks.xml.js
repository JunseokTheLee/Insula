import { pgFetchMany } from './_lib/supabase.js';

const SITE = 'https://weavo.art';

// Capped at 1000 rows (Supabase's default PostgREST page size) — once
// submissions grow past that, this should paginate into further
// sitemap-artworks-N.xml files listed from sitemap.xml's index, same
// pattern as splitting by content type already does.
export async function onRequestGet() {
  const subs = await pgFetchMany('mosaic_submissions?select=id,created_at&order=created_at.desc&limit=1000');

  const urls = subs.flatMap(s => {
    const en = `${SITE}/en/artworks/${encodeURIComponent(s.id)}`;
    const ko = `${SITE}/ko/artworks/${encodeURIComponent(s.id)}`;
    const lastmod = s.created_at ? `<lastmod>${new Date(s.created_at).toISOString()}</lastmod>` : '';
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
