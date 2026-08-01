# SEO Deployment Checklist

Manual, one-time-per-domain and post-deploy steps that can't be automated from
inside the codebase. Run through this after the first deploy of this work,
and re-check the "after every deploy" section on any deploy that touches
routing, redirects, or `_headers`/`_redirects`.

## One-time setup

- [ ] **Google Search Console**: add `weavo.art` as a Domain property (covers
      both `https://weavo.art/en/...` and `/ko/...`).
- [ ] Submit `https://weavo.art/sitemap.xml` in Search Console → Sitemaps.
- [ ] **Bing Webmaster Tools**: add the site, submit the same sitemap URL
      (Bing can also import verification/sitemaps directly from GSC).
- [ ] **네이버 서치어드바이저 (Naver Search Advisor)**: register the site,
      verify ownership, and submit `https://weavo.art/sitemap.xml` under
      요청 → 사이트맵 제출.
- [ ] Request indexing for the highest-value URLs directly (GSC → URL
      Inspection → Request Indexing): `/en/`, `/ko/`, `/en/projects`,
      `/ko/projects`, `/en/about`, `/ko/about`.

## Verification (after the first deploy)

- [ ] `https://weavo.art/robots.txt` loads and lists the sitemap.
- [ ] `https://weavo.art/sitemap.xml` loads and each nested sitemap
      (`sitemap-static.xml`, `sitemap-projects.xml`, `sitemap-artworks.xml`,
      `sitemap-artists.xml`) resolves with real entries.
- [ ] Google **Rich Results Test** on a real project URL, a real artwork
      URL, and a real artist URL — confirms `CreativeWork`/`VisualArtwork`/
      `Person`/`BreadcrumbList` parse with no errors.
- [ ] Google **URL Inspection** on `/en/`, `/en/projects`, a real
      `/en/projects/{id}`, a real `/en/artworks/{id}` — "Page is indexable",
      and the rendered HTML in the inspection tool shows the real
      title/description (confirms the Pages Function is actually firing in
      production, not just locally).
- [ ] **PageSpeed Insights** (mobile) on `/en/` and a project detail page —
      no regressions vs. pre-change baseline.
- [ ] **Mobile-Friendly** check (part of PSI / Search Console) on the same
      two URLs.
- [ ] Social share preview: paste a real `/en/artworks/{id}` URL into
      Twitter/X's card validator and a Facebook/LinkedIn share debugger —
      confirms `og:image` (the artwork itself) renders, not the fallback logo.
- [ ] Hit a handful of the **old** `?id=`/`?user=` links (if any were ever
      shared) and confirm each lands on the new clean URL via a real 301/308,
      not a broken page.
- [ ] Hit an intentionally-invalid path under `/en/`, `/ko/`, and the bare
      domain — confirms each returns an actual HTTP 404 (not a 200 with a
      "not found" *looking* page).
- [ ] Confirm the production **canonical domain** matches what's hardcoded
      in the templates/Functions (`https://weavo.art`) — if the real
      production domain ever differs (custom domain change, staging URL),
      every canonical/hreflang/OG URL and the three Functions'-`SITE`
      constants need updating together.

## Known follow-ups (not done in this pass — see final report for why)

- [ ] True `immutable`/1-year `Cache-Control` on CSS/JS requires content-hashed
      filenames, which requires introducing a build step — out of scope for
      this pass (see report). Until then, `/css/*` and `/js/*` use a
      1-hour revalidated cache.
- [ ] `sitemap-artworks.xml` is capped at Supabase's default 1000-row
      PostgREST page size — once submissions exceed that, split it into
      paginated `sitemap-artworks-N.xml` files listed from `sitemap.xml`.
- [ ] No dedicated 1200×630 social share image exists yet — OG/Twitter tags
      fall back to `logo.png` (3840×3840) wherever a project/artwork has no
      image of its own. A purpose-made share image would render better in
      link previews.
- [ ] Terms of Service / Community Guidelines pages don't exist yet — when
      they're written, follow the same pattern as `about`/`privacy`/
      `disclaimer` (clean URL, full meta set, added to `sitemap-static.xml`).
