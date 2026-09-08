# Weavo

**Weavo** ([weavo.art](https://weavo.art)) is a collaborative art-mosaic community. Artists upload their
artwork; Weavo reads each piece's dominant color and automatically places it in the best-matching
open cell across every active mosaic project. Nobody chooses where a piece goes — the full picture
only comes into focus as more artists add theirs. Zoomed out it reads as one image; zoomed in, every
"tile" is somebody's complete, credited artwork.

The project is built as a space where artists with and without disabilities take part side by side,
without distinction — every piece is an equal part of the whole.

> 한국어 요약은 아래 [한국어](#한국어) 절에 있습니다. 전체 설명 문서(영/한 전환 가능)는
> [`DevDocs/ProjectOverview_20260908.html`](DevDocs/ProjectOverview_20260908.html) 을 브라우저로 여세요.

## How it works

1. An artist uploads artwork from their profile (`js/profile-view.js`). No project is chosen, no tags.
2. `js/color-engine.js` samples the image (alpha-weighted, so transparent padding is ignored) and
   computes its average color.
3. `js/matching.js` places pool pieces into open cells across **all** non-archived projects — greedy,
   oldest upload first, nearest cell by Lab color distance, only if the match clears a quality bar.
4. Cell ownership is a `claim → attach → stale sweep` state machine enforced by Supabase row-level
   security (`supabase_mosaic.sql`), so concurrent uploads can't take the same cell.
5. There is no server process or cron: matching runs in the browser right after anything that
   changes either side of the match (upload, new project, reshape, removal), throttled DB-side.

## Stack

| Layer | Choice |
|---|---|
| Frontend | Plain static HTML / CSS / JS — **no build step, no bundler** |
| Hosting | Cloudflare Pages (`_headers`, `_redirects`, `functions/`) |
| Backend | Supabase — Postgres (RLS), Auth (Google / Apple sign-in), Storage (`artwork` bucket) |
| Libraries (CDN) | `@supabase/supabase-js@2`, `d3@7`, `topojson-client@3` |
| Languages | English `/en/` and Korean `/ko/` as fully separate page trees + `js/i18n/{en,ko}.js` |
| Android | `.well-known/assetlinks.json` → `art.weavo.app` (TWA) |

### Cloudflare Pages Functions (`functions/`)

- `index.js` — root `/` picks a language (cookie → `Accept-Language` → `en`) and 302-redirects.
- `_lib/render.js` + `{en,ko}/{projects,artworks,artists,collections}/[…].js` — server-side
  pre-rendering of `<head>` meta (title, description, canonical, hreflang, OG/Twitter, JSON-LD) for
  detail pages via `HTMLRewriter`. Same HTML to bots and browsers; client JS fills the tags again as
  a fallback.
- `img/[[path]].js` — proxies Supabase Storage objects through this origin so the Cloudflare edge
  cache absorbs repeat image requests.
- `sitemap-*.xml.js` — dynamic sitemaps for projects, artworks, artists, collections.
- `{en,ko}/profile.html.js`, `{en,ko}/project.html.js` — 301s from legacy `?id=` / `?user=` URLs.

## Repository layout

```
index.html              static language-chooser fallback (the Function above normally answers first)
en/, ko/                one HTML page per feature, per language (index = landing, projects, project,
                        artworks, artwork, artists, profile, collection, exhibitions, network,
                        about, privacy, disclaimer, delete-account, 404)
css/                    base.css + one stylesheet per page
js/                     common.js, auth.js, color-engine.js, matching.js, lightbox.js,
                        project.js, profile-view.js, network.js, notifications.js, …
js/i18n/                runtime-only strings (toasts, dialogs); static copy lives in the HTML itself
functions/              Cloudflare Pages Functions (see above)
supabase_*.sql          database schema, RLS policies, RPCs — run manually in the Supabase SQL editor
_headers, _redirects    Cloudflare Pages cache / security headers and redirects
robots.txt, sitemap*.xml
DevDocs/                developer documentation (not part of the product)
CLAUDE.md               rules for AI-assisted work in this repository
```

## Local development

There is nothing to build. To run the site locally with the Pages Functions:

```bash
npx wrangler pages dev .
```

(`wrangler` is present under `node_modules/`.) Opening the HTML files directly also works for pages
that don't depend on a Function.

## Deployment

The GitHub repository is connected to Cloudflare Pages (project `weavo`). **Every push to `main`
deploys to production at weavo.art automatically**; a "Cloudflare Pages" check appears on each commit.
Pushing is therefore a release, not a backup — see `CLAUDE.md`.

Because the repository root *is* the deploy root, every committed file is publicly reachable at
`https://weavo.art/<path>` unless excluded. Keep secrets out of the repository entirely (the anon key
in `js/supabase-client.js` is a public key by design).

## Database

Schema changes are plain SQL files (`supabase_*.sql`), each meant to be run once in the Supabase SQL
editor. `supabase_mosaic.sql` is the core (projects, pixels, submissions, admin flag); the others add
profiles, likes, "saves" (the app's word for user-to-user follows), comments, notifications, reports,
blocks, collections/exhibitions, thumbnails, versions, the profile-pool matching, reshape/rematch
RPCs, rate limiting and account deletion. There is no migration runner, so which files have been
applied is tracked outside the repository.

## Further reading

- `DevDocs/ProjectOverview_20260908.html` — full project overview (English, Korean toggle).
- `SEO_DEPLOYMENT_CHECKLIST.md` — manual post-deploy SEO checks and known follow-ups.
- `CLAUDE.md` — working rules for this repository.

---

## 한국어

**Weavo**(weavo.art)는 여러 사람의 작품이 모여 하나의 큰 모자이크를 완성하는 협업 예술 커뮤니티입니다.
작가는 프로필에서 작품만 올리면 됩니다. Weavo 가 작품의 대표 색상을 자동으로 읽어, 진행 중인 **모든**
프로젝트를 통틀어 색이 가장 잘 맞는 빈 칸에 자동 배치합니다. 사람이 위치나 소속 프로젝트를 정하지 않으며,
작품이 쌓인 뒤에야 전체 그림이 드러납니다. 장애인·비장애인 아티스트가 구분 없이 나란히 참여하는 것을 지향합니다.

- **구성**: 빌드 없는 순수 정적 HTML/CSS/JS + Cloudflare Pages(Functions) + Supabase(Postgres/Auth/Storage)
- **다국어**: `/en/`, `/ko/` 페이지 트리 완전 분리, 런타임 문자열만 `js/i18n/`
- **배포**: GitHub `main` 에 push 하면 Cloudflare Pages 가 자동으로 운영 사이트에 배포 (push = 릴리스)
- **DB**: `supabase_*.sql` 을 Supabase SQL 에디터에서 수동 실행 (마이그레이션 도구 없음)
- **로컬 실행**: `npx wrangler pages dev .`
- **문서**: 전체 설명은 `DevDocs/ProjectOverview_20260908.html` (영어 기본, 한국어 전환), 작업 규칙은 `CLAUDE.md`
