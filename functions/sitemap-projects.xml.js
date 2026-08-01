import { pgFetchMany } from './_lib/supabase.js';

const SITE = 'https://weavo.art';

// Only current (non-archived) projects — an archived iteration is a
// legitimate distinct page (kept indexable, linked from its live successor),
// but isn't sitemap-listed itself so crawl budget isn't split across
// superseded copies of the same project.
export async function onRequestGet() {
  const projects = await pgFetchMany('mosaic_projects?is_archived=eq.false&select=id,created_at&order=created_at.desc&limit=1000');

  const urls = projects.flatMap(p => {
    const en = `${SITE}/en/projects/${encodeURIComponent(p.id)}`;
    const ko = `${SITE}/ko/projects/${encodeURIComponent(p.id)}`;
    const lastmod = p.created_at ? `<lastmod>${new Date(p.created_at).toISOString()}</lastmod>` : '';
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
