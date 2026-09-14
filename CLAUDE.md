# CLAUDE.md — Weavo (weavo.art) 개발 가이드

이 문서는 Claude(AI)가 본 저장소에서 작업할 때 반드시 따라야 할 규칙이다. 작업을 시작하기 전에 이 문서를 먼저 읽는다.
문서는 두 부분으로 되어 있다.

1. **이 저장소 고유 규칙** (바로 아래) — 프로젝트 구조·배포·다국어·DB·문서 규칙
2. **공통 개발 규칙 사본** (문서 끝) — `D:\O___GIT\CLAUDE.md` 의 내용을 그대로 복사한 것. 저장소를 단독으로 clone 해도 규칙이 유지되도록 한 **의도된 중복**이다.

**두 부분이 서로 다르면 이 저장소 고유 규칙이 우선한다.** (예: 코드 주석 언어, 버전 체계 유무)

---

## 1. 프로젝트 개요

- **서비스**: Weavo — 협업 포토모자이크 커뮤니티 (https://weavo.art). 폴더 이름은 `Insula` 지만 서비스명은 Weavo 다.
- **핵심 동작**: 작가가 프로필에서 작품을 올리면 대표 색상을 자동 분석해, 진행 중인 **모든** 프로젝트를 통틀어 색이 가장 잘 맞는 빈 칸에 자동 배치한다. 사람이 위치·소속 프로젝트를 정하지 않는다.
- **지향점**: 장애인·비장애인 아티스트가 구분 없이 나란히 참여하는 공간.
- **저장소**: https://github.com/JunseokTheLee/Insula (공개 저장소)
- **전체 설명 문서**: `DevDocs/ProjectOverview_20260908.html` (영어 기본, 한국어 전환). 프로젝트 파악은 이 문서와 `README.md` 부터 읽는다.
- **용어**: UI 의 "Save / Saving" 은 사용자 간 **팔로우**다 (`user_saves` 테이블, 네트워크 그래프의 바탕). "Collection" 을 발행하면 "Exhibition(전시)" 으로 보인다 (`mosaic_collections`). `cell_likes`·`cell_comments`·`profile_comments` 테이블은 예전 버전의 잔재로 현재 페이지 코드가 쓰지 않는다.

---

## 2. 기술 스택·구조 (확정)

| 영역 | 내용 |
|---|---|
| 프론트 | **빌드 스텝 없는 순수 정적 HTML/CSS/JS** (번들러·트랜스파일러·프레임워크 없음) |
| 외부 라이브러리 | CDN 직접 로드 — `@supabase/supabase-js@2`, `d3@7`, `topojson-client@3` (jsdelivr) |
| 분석 | Google Analytics(gtag.js, 측정 ID `G-NLXNX3C6KW`) — 34개 HTML 전부의 `<meta charset>` 바로 뒤 (2026.9.13 사용자 지시로 도입) |
| 호스팅 | **Cloudflare Pages** — `_headers`, `_redirects`, `functions/` (Pages Functions) |
| 백엔드 | **Supabase** — Postgres(RLS), Auth, Storage(`artwork` 버킷). 별도 서버·크론 **없음** |
| 다국어 | `/en/`, `/ko/` 페이지 트리 완전 분리 + `js/i18n/{en,ko}.js` (런타임 문자열만) |
| Android | `.well-known/assetlinks.json` → `art.weavo.app` (TWA). 안드로이드 프로젝트는 이 저장소에 없다 |
| 푸시 | 브라우저는 루트 `sw.js`(푸시 전용 서비스 워커) + `manifest.webmanifest`, 앱은 FCM. 등록은 양쪽 다 `js/push.js`, 발송은 Supabase Edge Function `push` 하나가 겸한다 |
| 모바일 앱 | Flutter WebView 컨테이너 (`art.weavo.app`, Firebase 프로젝트 `weavo-art`). **앱 저장소는 별도이고 이 저장소에 없다.** 웹은 `window.WeavoAppBridge` 로만 앱과 이야기한다 |
| 로컬 도구 | `node_modules/` 에 wrangler·miniflare 포함 (아래 10절 참고) |

**서버 로직은 `functions/` 에만 있다.**
- `functions/index.js` — 루트 `/` 언어 판별 302 (쿠키 → Accept-Language → en)
- `functions/_lib/render.js` — 상세 페이지 `<head>` 메타(title/description/canonical/hreflang/OG/JSON-LD)를 HTMLRewriter 로 서버에서 채움
- `functions/{en,ko}/{campaigns,artworks,artists,collections}/[…].js` — 위 렌더러를 쓰는 상세 페이지 라우트
- `functions/img/[[path]].js` — Supabase Storage 이미지를 같은 도메인으로 프록시해 엣지 캐시 (`js/common.js` 의 `cdnUrl()` 이 `/img/` 로 바꿔 보냄)
- `functions/sitemap-*.xml.js` — 동적 사이트맵
- `functions/{en,ko}/{profile,project}.html.js` — 옛 `?id=`/`?user=` 주소 301
- `functions/{supabase,DevDocs,tools}/[[path]].js` — 저장소에만 필요한 폴더(SQL·개발 문서·도구)를 웹에서 404 로 막음 (2026.9.10). Function 경로가 정적 파일보다 우선하므로 해당 폴더의 파일은 어떤 주소로도 내려받을 수 없다.

### 절대 추가하지 말 것
- 빌드 스텝(번들러, 트랜스파일러, CSS 전처리기). 캐시 무력화는 파일명 해시 대신 `?v=` 버전 쿼리로 한다 (12절).
- **`sw.js` 에 fetch 핸들러·캐시를 넣지 않는다.** `/js`·`/css` 는 이미 1년 immutable + `?v=` 로 관리하는데(12절), 서비스 워커 캐시를 얹으면 그 위에 규칙이 다른 두 번째 캐시가 생긴다 — 2026.9.10 의 엣지 캐시 오염과 같은 종류의 버그를 눈에 보이지 않는 곳에 하나 더 만드는 셈이다. 서비스 워커의 일은 푸시가 올 때 살아 있는 것뿐이다.
- 서버 상주 프로세스·크론에 기대는 기능. 매칭은 이벤트 시점에 브라우저에서 돌고 결과는 `commit_pool_matches` RPC 가 서버에서 재검증해 기록하며, 정리 작업은 DB 쪽 스로틀(`claim_rematch_slot`)로 동시 실행을 막는 구조다.
- 새 외부 CDN·스크립트. 꼭 필요하면 `_headers` 의 CSP 미도입 사유 주석과 함께 사용자에게 먼저 확인한다. **예외 하나 — Google Analytics (2026.9.13 사용자 지시).** 구글이 준 gtag.js 조각을 그대로 34개 HTML 에 넣었다. `<head>` 맨 앞이 아니라 `<meta charset="UTF-8">` **바로 뒤**에 두는데, charset 선언은 문서 앞 1024바이트 안에 있어야 하므로 그것을 밀어내면 안 되기 때문이다(`async` 로 받으므로 이 위치 차이는 측정에 영향이 없다). 태그를 옮기거나 페이지를 새로 만들 때 이 순서를 지킨다. **GA 는 제3자 쿠키를 설정하므로 `{en,ko}/privacy.html` 의 "쿠키 및 세션" 절이 이를 명시한다 — 태그를 빼면 그 문구도 함께 되돌린다.**

---

## 3. 배포 규칙 (필수 · 최우선)

- **GitHub `main` 에 push 하면 Cloudflare Pages(프로젝트 `weavo`)가 운영 사이트 weavo.art 에 자동 배포한다.** (2026.9.8 확인 — 커밋마다 "Cloudflare Pages" 체크가 붙고, 최신 커밋 내용이 사이트에 즉시 반영됨)
  → **push = 운영 릴리스다.** 공통 규칙의 "push 는 콕 집어 지시할 때만" 은 이 저장소에서 특히 중요하다. 로컬 `main` 이 `ahead` 로 남는 것이 정상이다.
- **저장소 루트가 곧 배포 루트다.** 커밋한 파일은 예외 없이 `https://weavo.art/<경로>` 로 공개된다.
  - 비밀값(서비스 롤 키, 토큰, 계정 정보)은 **어떤 파일에도 넣지 않는다.** `js/supabase-client.js` 의 anon 키는 공개용 키라 예외.
  - 개발 문서는 `DevDocs/`, SQL 은 `supabase/`, 도구는 `tools/` 에 둔다. 이 세 폴더는 `functions/<폴더>/[[path]].js` 가 404 를 돌려 웹에서 접근할 수 없고 `robots.txt` 에도 Disallow 되어 있다 (2026.9.10). 그래도 비밀값은 저장소에 넣지 않는다.
- 배포 후 확인이 필요한 항목(SEO·리다이렉트·헤더)은 `SEO_DEPLOYMENT_CHECKLIST.md` 를 따른다.

---

## 4. 다국어 규칙 (반드시 준수)

- 페이지는 `en/` 과 `ko/` 에 **같은 이름으로 한 쌍**씩 있다. **한쪽만 고치지 않는다.** 마크업·스크립트 변경은 양쪽에 똑같이 반영하고, 본문 문구만 언어별로 다르다.
- 정적 문구는 HTML 안에 직접 쓴다 (`data-i18n` 방식 아님). JS 가 런타임에 만드는 문구(토스트·확인창·템플릿 메시지)만 `js/i18n/en.js` 와 `js/i18n/ko.js` 의 `T` 객체에 **같은 키로 양쪽 모두** 추가하고 `tr()` 로 꺼낸다.
- 언어 판별: `window.CURRENT_LANG` (i18n 파일이 설정). 링크는 `/${CURRENT_LANG}/...` 로 만든다.
- `<head>` 의 canonical/hreflang/OG 태그도 페이지 쌍마다 서로를 가리키므로 새 페이지를 만들면 양쪽 모두 갱신하고 `sitemap-static.xml` 에도 추가한다.

---

## 5. 상세 페이지 메타 규칙

프로젝트·작품·작가·전시 상세 페이지의 title/OG/JSON-LD 는 **두 곳**에서 채운다.
- 서버: `functions/_lib/render.js` 를 쓰는 `functions/{en,ko}/…/[id].js`
- 클라이언트 폴백: `js/project.js` 의 `updateProjectMeta()`, `js/profile-view.js` 의 `updateProfileMeta()` 등

메타 형식·문구를 바꾸면 **양쪽을 함께** 고친다. 한쪽만 바꾸면 Function 을 거치지 않은 요청에서 다른 결과가 나온다.

- **캠페인의 og:image·JSON-LD image 에 기준 사진(`reference_image_url`)을 쓰지 않는다** (2026.9.10 확정). `preview_image_url`(회색 1200×630 공유 카드 — 생성·reshape 때 브라우저가 만들고, 옛 캠페인은 관리자 "공유 이미지 생성")을 쓰고 없으면 `/logo.png`. Function 은 `select=*` 로 읽어 컬럼이 없어도 동작한다.

---

## 6. DB(Supabase) 변경 규칙

- 스키마·RLS·RPC 변경은 **`supabase/supabase_<기능>.sql`** 파일로 남긴다 (2026.9.10 부터 `supabase/` 폴더; 웹에서는 Function 이 404 로 막는다). 파일 머리에 기존 파일과 같은 형식의 실행 안내 주석(`-- Run this once in the Supabase SQL editor …`)과 목적 설명을 쓴다.
- **마이그레이션 도구가 없다.** 파일은 사람이 Supabase SQL 에디터에서 직접 실행한다. 따라서
  - 새 SQL 은 **멱등**하게 쓴다 (`if not exists`, `drop policy if exists` 후 `create policy`, `add column if not exists`).
  - 코드가 새 컬럼·RPC 에 의존하면 **어떤 SQL 파일을 먼저 실행해야 하는지 보고에 반드시 적는다.** 적용 여부는 저장소에 기록되지 않으므로 사용자에게 확인한다.
- **새 테이블을 만들면 `revoke all ... from anon, authenticated` 를 먼저 쓰고 필요한 것만 grant 한다** (2026.9.11 확인). Supabase 는 `public` 스키마의 새 테이블에 anon·authenticated 로 ALL 을 기본 부여하므로, grant 문만 쓰면 실제 권한이 의도보다 넓어진다(행은 RLS 가 막지만 권한 자체는 열려 있다). 기존 테이블 중 `visit_days` 만 이 패턴을 지키고 있었고, 2026.9.11 에 `push_subscriptions`(엔드포인트는 곧 알림을 보낼 수 있는 권한)와 `admin_audit_log`(고칠 수 없어야 하는 기록)도 같게 맞췄다. `notifications`·`reports` 등은 아직 기본 권한 상태다 — RLS 가 막고 있으나 정리 대상.
- 권한은 RLS 정책과 컬럼 단위 grant 로 건다. `is_admin` 은 클라이언트가 바꿀 수 없어야 한다 (`supabase_mosaic.sql` 1절 참고). 정책을 느슨하게 푸는 변경은 사용자에게 먼저 확인한다.
- 셀 점유는 `claim → attach → stale sweep(10분)` 상태 머신이다. `mosaic_pixels` 의 update 정책을 고칠 때는 이 세 단계가 모두 유지되는지 확인한다.
- **2026.9.10 추가 SQL (실행 순서; 아래 3개와 `supabase_profiles_username_rules.sql` 모두 2026.9.10 운영 DB 적용 완료 — 사용자 확인)**: ① `supabase_mosaic_grid_image.sql`(`grid_image_url` 컬럼, 7인자 reshape RPC) → ② `supabase_mosaic_server_matching.sql`(Lab 컬럼·트리거·백필, `match_pool_artworks`·`release_poor_matches`·`admin_usage_stats`). 코드는 둘 다 **미적용 상태에서도 옛 경로로 동작**하도록 폴백을 두었으므로 push 순서와 무관하지만, 적용 전까지는 격자 이미지·서버 매칭·관리자 사용량 표시가 비활성이다. ③ `supabase_site_settings.sql`(사이트 옵션 테이블·RPC, 다른 둘과 독립)은 적용 전까지 모든 옵션이 기본값으로 동작하고 관리자 페이지의 옵션 섹션이 비활성이다 (16절). ④ `supabase_mosaic_micro_thumbs.sql`(`thumb/` 업로드 Storage 정책, `micro_thumb` 컬럼, `admin_set_submission_thumbs`)은 **미적용이면 썸네일 업로드가 계속 실패**하고(2026.8~9 전 작품이 그랬음) 관리자 "썸네일 생성" 이 비활성이다. ⑤ `supabase_mosaic_like_count.sql`(`like_count` 컬럼·가드·집계 트리거·백필)은 미적용이면 작품 탐색이 최신순만 되고 인기순이 최신순으로 폴백한다. ⑥ `supabase_mosaic_preview_image.sql`(`preview_image_url` 컬럼)은 미적용이면 공유 이미지가 로고로 나가고 관리자 "공유 이미지 생성" 이 실패한다. ⑦ `supabase_visit_stats.sql`(`visit_days` 테이블, `record_visit`·`admin_visit_stats` RPC; ③ 뒤에 실행, 2026.9.10 운영 DB 적용 완료 — 사용자 확인)은 미적용이면 방문이 기록되지 않고(브라우저당 하루 1회 실패 요청) 관리자 "방문 통계" 가 안내문만 보인다. ⑧ `supabase_mosaic_sponsor.sql`(캠페인별 기부 약정: `sponsor_name`·`sponsor_logo_url`·`sponsor_tagline`·`pledge_amount` 기본 500,000; 다른 파일과 독립)은 **2026.9.12 에 ⑬ 으로 되돌렸고 2026.9.13 에 운영 DB 에서 네 컬럼이 사라진 것을 실측했다 — 다시 실행하지 말 것.** ⑨ `supabase_mosaic_pieces.sql`(작품 조각: `parent_id`·`piece_row/col/n`·`home_project_id`·`match_tried_at` 컬럼, `cells_changed_at`, `set_submission_pieces` RPC, 매칭·해제·빼기·캠페인 삭제 RPC 와 통계 재정의; ②·③ 뒤에 실행, 2026.9.10 운영 DB 적용 완료 — 사용자 확인)은 미적용이면 작품이 예전처럼 통째로 한 칸에 매칭되고 관리자 "작품 조각" 이 안내문만 보인다. 적용 직후 관리자 "작품 조각 → 조각 생성" 으로 기존 작품을 일괄 전환한다. ⑩ `supabase_mosaic_pieces_retry.sql`(`admin_reset_piece_tries` RPC; ⑨ 뒤에 실행, 2026.9.10 운영 DB 적용 완료 — 사용자 확인)은 미적용이면 관리자 "색 기준 전체 적용" 버튼이 안내 토스트만 낸다. **주의: 옛 파일 `supabase_mosaic_rematch.sql`(`mosaic_meta`·`claim_rematch_slot`·`unmatch_submissions`)이 2026.9.10 까지 운영에 적용된 적이 없었다** — `release_poor_matches` 가 호출마다 42883 으로 실패했지만 `matching.js` 가 "함수 없음" 오류를 무시해 6시간 정리가 조용히 안 돌고 있었다. ⑩ 과 정리 작업 모두 이 파일이 필요하다(2026.9.10 운영 DB 적용 완료 — 사용자 확인).
- **2026.9.11 재실행 필요**: `supabase_visit_stats.sql` — `admin_visit_stats` 의 "신규 작품" 이 조각 행까지 세어 업로드 1건이 약 50건으로 표시되던 버그를 고쳤다(`parent_id is null` 추가). 파일 전체가 멱등하고 데이터를 건드리지 않으므로 그대로 다시 실행하면 된다. ⑨ 뒤에 실행. (2026.9.11 재실행 완료 — 사용자 확인)
- **2026.9.13 추가 SQL**: ⑯ `supabase_game.sql`(조각 찾기 게임: `game_sessions`·`game_best_records` 테이블, `start_game`·`finish_game`·`game_artwork_stats`·`game_used_piece_count` RPC; ⑨ 와 ③ 뒤에 실행, 2026.9.13 운영 DB 적용 확인 — anon 으로 `game_used_piece_count(15, 2194)`=25 와 `game_artwork_stats` 200 을 받고, `game_sessions`·`start_game` 은 42501 로 거부되는 것을 실측). 미적용이면 `/{lang}/game` 에서 **게임은 되지만 순위와 기록이 없다** — 목록·플레이·완료까지 그대로 동작하고 랭킹 RPC 실패는 무시한다(의도된 graceful degradation). **기록을 서버 시각으로 재는 이유**: 브라우저가 보낸 경과 시간은 devtools 에서 고칠 수 있으므로 아예 받지 않는다. `start_game` 이 서버 시각을 찍고 `finish_game` 이 다시 읽어 뺀다 — 화면의 타이머는 표시용이다. 다만 **조각을 정말 다 찾았는지는 서버가 알 수 없다** — 정적 사이트라 신뢰할 게임 서버가 없고, 완료를 선언하는 것은 클라이언트다. 조각당 250ms 하한이 이 구조에서 가능한 방어선의 끝이다.
- **2026.9.13 추가 SQL**: ⑮ `supabase_admin_broadcast.sql`(관리자 전체 공지: `notifications.title` 컬럼과 `announcement` 타입, `admin_broadcast_notification(title, body)` RPC, **`claim_push` 재정의**; ⑭ 와 ⑪ 뒤에 실행, **적용 여부 확인 필요**). 미적용이면 관리자 "공지" 탭이 안내문만 보이고 입력·발송 버튼이 잠긴다(화면이 `notifications.title` 컬럼을 찔러 보고 판단한다 — RPC 를 불러서 확인할 수는 없다. 부르는 순간 발송되기 때문이다). **발송은 기존 경로를 그대로 탄다** — 회원 한 명당 `notifications` 행 하나를 넣고, `supabase_push.sql` 의 AFTER INSERT 트리거가 좋아요·댓글과 똑같이 내보낸다. 그래서 공지 기능이 개별 알림 발송을 망가뜨릴 수 없다. **주의: `claim_push` 가 이제 세 파일(⑫·⑭·⑮)에 있다. ⑮ 가 최신이므로 앞의 둘을 다시 실행했다면 ⑮ 를 뒤이어 다시 실행한다** — 안 하면 공지 푸시 제목이 빈 채로 나간다.
- **2026.9.12 추가 SQL**: ⑭ `supabase_push_tokens.sql`(앱 푸시: `push_tokens` 테이블, `save_push_token`·`drop_push_token` RPC, **`claim_push` 재정의**; ⑫ 뒤에 실행, 2026.9.13 운영 DB 적용 확인 — anon 으로 `push_tokens` 존재와 권한 거부(42501)를 실측). 미적용이면 앱이 토큰을 저장하지 못해 앱 알림만 오지 않고 브라우저 푸시는 그대로 동작한다. **재정의된 `claim_push` 가 중요한 이유**: 옛 버전은 브라우저 구독이 0건이면 `pushed_at` 을 이미 찍은 뒤 null 을 돌려줬다 — 앱만 쓰는 사용자에게는 알림이 영영 가지 않고 그 행은 재시도도 안 된다. 새 버전은 구독과 토큰이 **둘 다** 0건일 때만 null 을 돌려주고, 앱 배지용 미읽음 수도 함께 준다. `supabase_push.sql` 은 손대지 않았으므로 두 파일을 순서대로 실행하면 된다.
- **2026.9.12 추가 SQL**: ⑬ `supabase_mosaic_sponsor_drop.sql`(⑧ 을 되돌려 `mosaic_projects` 에서 `sponsor_name`·`sponsor_logo_url`·`sponsor_tagline`·`pledge_amount` 네 컬럼을 제거; 언제든 실행 가능, 2026.9.13 운영 DB 적용 확인 — anon 으로 `sponsor_name` 이 없음(42703)을 실측). **되돌릴 수 없다 — 컬럼을 지우면 그 데이터도 사라진다.** 실행 전 운영 확인 결과 캠페인은 하나("Side by Side")뿐이고 약정 값은 `pledge_amount = 200000` 하나뿐이었다(기업명·로고·문구는 한 번도 설정된 적 없음 → 고아가 되는 Storage 파일 없음). 미적용이면 컬럼만 남고 코드는 이미 쓰지 않으므로 화면 동작에는 영향이 없다.
- **2026.9.11 추가 SQL**: ⑫ `supabase_push.sql`(웹 푸시: `push_subscriptions` 테이블, `notifications.pushed_at`, `claim_push`·`drop_push_subscription` RPC(서비스 롤 전용), `pg_net` 으로 Edge Function 을 부르는 AFTER INSERT 트리거; `supabase_notifications.sql`·`supabase_site_settings.sql` 뒤에 실행, 2026.9.11 운영 DB 적용 확인 — anon 으로 테이블·RPC 존재와 권한 거부를 실측). 미적용이면 알림 패널의 "알림 받기" 가 구독을 저장하지 못하고 푸시가 발송되지 않는다(화면은 그대로 동작). SQL 만으로는 부족하고 ⓐ `node tools/generate-vapid-keys.js` 로 만든 공개 키와 Edge Function 주소를 관리자 "사이트 옵션 → 푸시 알림" 에 넣고 ⓑ 비밀 키를 Supabase 비밀값으로 등록한 뒤 ⓒ `supabase functions deploy push --no-verify-jwt` 까지 해야 동작한다. **ⓐ~ⓒ 모두 2026.9.13 완료 — 실기기에서 브라우저·앱 알림 수신 확인(사용자 확인).** Verify JWT 를 켜면 pg_net 이 인증 헤더 없이 호출하므로 게이트웨이가 401 을 돌려주고 발송이 조용히 전부 막힌다 — 함수를 다시 배포할 때 `--no-verify-jwt` 를 빠뜨리지 않는다.
- **2026.9.11 추가 SQL**: ⑪ `supabase_admin_moderation.sql`(관리자 모더레이션 — 댓글 삭제 정책에 관리자 추가, `admin_audit_log` 테이블과 `admin_log_action` RPC, `profiles.upload_blocked` 컬럼과 `admin_set_upload_blocked` RPC, 업로드 속도 제한을 사이트 옵션에서 읽도록 재정의, 관리자용 Storage list/delete 정책; ⑨ 와 ③ 뒤에 실행, 2026.9.11 운영 DB 적용 확인 — `profiles.upload_blocked`·`admin_audit_log`·RPC 존재를 실측). 미적용이면 관리자 페이지에서 ⓐ 댓글 삭제가 조용히 거부되고(RLS 가 정책 없이 0행 삭제) ⓑ "기록" 탭이 안내문만 보이며 ⓒ 업로드 차단이 비활성이고 ⓓ 작품을 지워도 Storage 원본 파일이 남는다. 작품 행 삭제 자체는 기존 정책으로 동작한다. **주의: `enforce_mosaic_submission_rate_limit()` 이 세 파일(`supabase_mosaic_submissions_rate_limit.sql`·`supabase_mosaic_pieces.sql`·⑪)에 모두 있다** — ⑪ 이 최신이므로 앞의 둘을 다시 실행했다면 ⑪ 을 뒤이어 다시 실행한다.

---

## 7. 코드 규칙

- **코드 주석은 영어로 쓴다.** 기존 코드 전체가 영어 주석이므로 주변 코드와 통일한다. (공통 규칙의 "주석 한국어" 보다 이 항목이 우선. 채팅 응답·커밋 메시지·문서는 공통 규칙대로 한국어)
- 로그·에러 메시지 문자열은 영어.
- 전역 함수·`const` 를 파일 간에 공유하는 구조다 (모듈 시스템 없음). 로드 순서가 곧 의존 순서이므로 각 파일 머리 주석의 "Needs … loaded first" 를 지키고, 새 파일도 같은 형식의 머리 주석을 단다.
- 사용자 입력으로 만든 링크는 `safeHref()`, HTML 삽입은 `escapeHtml()` 을 거친다.
- Supabase Storage URL 은 `cdnUrl()` 로 감싸 `/img/` 프록시를 타게 한다.
- **캠페인 칸의 색은 `loadProjectCells(project)`(common.js)로 읽는다.** 프로젝트에 `grid_image_url`(정적 PNG, `/img/` 캐시)이 있으면 그 이미지에서, 없거나 못 읽으면 `mosaic_pixels` 조회로 자동 폴백한다. 격자·미리보기·필요한 색상이 모두 이 경로를 쓰므로 `mosaic_pixels` 를 직접 전체 조회하지 않는다 (2026.9.10, `supabase_mosaic_grid_image.sql`). 이미지가 없는 옛 캠페인은 관리자 페이지의 "격자 이미지 생성" 버튼으로 한 번 만든다(업로드한 PNG 를 다시 읽어 칸과 일치하는지 검증한 뒤 `grid_image_url` 기록).
- **매칭은 서버 RPC(`match_pool_artworks`·`release_poor_matches`)가 한다.** `matching.js` 는 RPC 를 먼저 부르고, 함수가 없을 때(PGRST202)만 옛 클라이언트 계산으로 폴백한다. 매칭 규칙(Lab 거리·가중치 0.2)을 바꾸면 **SQL 과 color-engine.js 를 함께** 고친다. 색 일치 한계는 사이트 옵션 `pieceMatchDistance`(기본 20)를 서버가 읽는다(클라이언트 폴백·reshape 는 옛 상수 30).
- **작품은 N×N 조각으로 잘려 조각이 칸에 들어간다** (2026.9.10, `supabase_mosaic_pieces.sql`). 조각은 `mosaic_submissions` 의 행(`parent_id` → 원작, `piece_row/col/n`, 원작의 작가·이미지 복사, 자기 평균색·`micro_thumb`)이며 원작 행은 다시는 배치되지 않는다(`piece_n` 이 "잘림" 표시). 업로드 때 브라우저가 `makeArtworkPieces()`(common.js)로 자르고 `set_submission_pieces` RPC 가 행을 만든다(관리자는 남의 작품도 가능 — "작품 조각" 도구). **작품 목록 조회는 반드시 `parent_id is null` 로 조각을 뺀다**(홈 최근 작품·탐색·프로필·컬렉션 피커·관리자·사이트맵이 그렇게 하고, 컬럼이 없으면 필터 없이 재시도). **목록뿐 아니라 "작품 수" 를 세는 모든 집계(SQL 뷰·RPC·`count: 'exact'`)에도 같은 필터가 필요하다** — 업로드 한 번이 행 50개를 만들기 때문에 빠뜨리면 수치가 약 50배가 된다. 2026.9.11 에 `admin_visit_stats` 의 "오늘 신규 작품" 이 그래서 2를 100으로 표시했다(`mosaic_stats`·`admin_usage_stats` 는 `supabase_mosaic_pieces.sql` 이 이미 고쳐 둔 상태였다). 새 집계를 만들 때 이 줄을 먼저 확인한다. 캠페인 칸의 조각은 원작을 함께 읽어(`fetchPieceParents`, project.js) 클릭·링크·목록이 원작으로 가고, 라이트박스는 조각 위치를 작게 표시하고, 조각 사용률("조각 12/49 사용")은 라이트박스와 독립 작품 페이지 양쪽에 같은 함수(`renderLightboxPieceUsage`)로 나온다. 작품당 캠페인 하나에 고정(`home_project_id`, 조각을 처음 만들 때의 최신 활성 캠페인; 캠페인 삭제 시 `delete_mosaic_project` 가 최신 캠페인으로 재할당). 조각 이미지 파일은 없다 — 확대 시 원작 썸네일을 `background-size/position` 으로 잘라 보인다. 기여 금액·"내 조각" 은 칸 수를 세므로 자동으로 조각 단위다.
- **`profiles.avatar_url` 은 행이 새로 생길 때만 OAuth 사진으로 채운다** (2026.9.12). `upsertBaseProfile()` 이 로그인마다 `me.avatar` 를 써 넣던 탓에, 사용자가 프로필 사진을 지우면 다음 접속에 구글 사진이 그대로 되살아났다(행은 null 인데 `loadMyProfile()` 이 "저장된 값이 있을 때만" 쓰도록 돼 있어 `me.avatar` 가 OAuth 사진으로 남고, 그것이 다시 저장됐다). 이제 기존 행에는 `id` 만 upsert 하고, `loadMyProfile()` 은 **행이 있으면 빈 값이라도 그 값을 쓴다.**
- **캠페인의 기준 이미지 원본(`reference_image_url`)은 화면에 직접 보여주지 않는다** (2026.9.10 확정). 캠페인이 완성될 때까지 숨겨야 하는 그림이므로, 캠페인을 보여주는 곳(홈 히어로·캠페인 목록·프로필의 참여 캠페인)은 모두 `paintProjectPreview()`(project-preview.js: 빈 칸은 회색, 채워진 칸은 초소형 썸네일)로 그린다. 빈 칸 회색은 `openCellPainter(cells, settings)`(common.js)가 `previewContrast`(기본 40)·`previewBrightness`(기본 70)·`previewTint`(기본 `#DCE4ED`) 옵션으로 대비를 낮추고 평균 밝기를 맞춘 뒤 틴트 색조를 입혀 만든다 — 캠페인 격자와 공유 카드도 같은 함수를 쓴다 (2026.9.10). 새로 캠페인을 노출하는 화면을 만들 때도 같은 렌더러를 쓴다.
$1 (`common.js` `makeArtworkDerivatives`): 긴 변 480px JPEG 는 `thumb/<작가id>/` 에 올려 `thumb_url` 에, 원본이 이미 480px 이하면 원본 URL 을 그대로 `thumb_url` 에 넣는다(별도 파일 없음). 16×16 JPEG data URI 는 `micro_thumb` 컬럼에 넣어 캠페인 캔버스가 배율과 무관하게 작은 그림으로 그린다. 둘 중 하나라도 빠진 작품은 관리자 페이지 "작품 썸네일" 에서 세고 재생성한다. 화면은 항상 `thumb_url || image_url` 순으로 쓴다.
$1(common.js)로 받는다.** Supabase 는 응답을 기본 1,000행에서 조용히 잘라낸다 — 캠페인 칸(`mosaic_pixels`, 최대 10,000)이 대표적. 2026.9.9 에 58×86 캠페인이 상단 1,000칸만 그려지고 개수·매칭이 어긋난 원인이었다. 페이지 수를 알면 `expected`(예: `width*height`)를, 모르면 `select(cols, { count: 'exact' })` 를 넘겨 병렬로 받는다.
- **홈 히어로는 금액을 전혀 표시하지 않는다 — 모든 수치는 조각 단위다** (2026.9.12 사용자 지시). 예전에는 약정 기업 로고·기업명·홍보 문구와 "₩458,300 / ₩2,000,000", "내가 기여한 금액" 을 히어로에 띄웠다. 앱스토어 심사에서 "사용자가 앱에서 구매를 할 수 있느냐" 는 질문을 받은 것도 이 표시 때문으로 보여, 히어로에서 모두 걷어냈다. 지금 히어로에는 ⓐ 하트 아이콘 + 채워진 조각 수·비율(`.hero-progress`, 예전 기부 카드에 있던 하트를 이 카드로 옮겼다) ⓑ 로그인한 사용자의 참여 조각 수와 전체 대비 비율(`.hero-mine`, `renderHeroMine`) 만 있다. 비율은 `mine / total`(조각 기준)이며 0.1% 미만은 소수 둘째 자리까지 보여 한 조각이 "0.0%" 로 반올림되지 않게 한다.
  - 히어로 아래에는 **그 캠페인에 조각이 들어간 작품의 썸네일 가로 목록**(`.hero-strip`, `renderHeroStrip`)이 붙는다 — 칸에 들어 있는 것은 조각이므로 `parent_id` 로 원작을 모아 캠페인당 한 번만 조회하고 캐시한다(`fetchPreviewFilled` 가 `id`·`parent_id` 를 함께 받아 온다). 작품이 많으면 목록만 가로로 스크롤되고 페이지에는 가로 스크롤이 생기지 않는다.
  - "내가 참여한 작품" 은 **작품 수와 조각 수를 함께** 보여준다(예: "6작품 131조각"). 조각 49개가 한 작품이므로 `parent_id` 로 묶어 세며, 비율은 조각 기준이다.
  - **2026.9.12 에 뿌리까지 걷어냈다** (사용자 지시): DB 의 약정 컬럼 네 개를 `supabase_mosaic_sponsor_drop.sql` 로 제거했고, 캠페인 생성 폼(`np-sponsor`·`np-logo-picker`·`np-tagline`·`np-pledge`)과 관리자 캠페인 수정 폼(`aec-*`)의 해당 입력, `pledgeAmountOf()`·`parsePledgeInput()`(common.js), 관련 i18n 키와 `.logo-picker` CSS 까지 함께 지웠다. **이 저장소의 어떤 화면·폼·컬럼도 금액을 다루지 않는다.** 금액을 다시 들여오는 변경은 앱스토어 심사(가이드라인 2.1·3.2.1) 영향을 먼저 확인하고 사용자에게 묻는다.
- **모든 페이지의 좌우 폭은 하나의 공용 프레임으로 맞춘다 — 상단 바의 Weavo 로고와 세로줄이 맞아야 한다** (2026.9.11 확정, 사용자 지시). 페이지마다 `max-width` 를 따로 정하던 탓에 페이지를 옮길 때마다 본문 시작 위치가 좌우로 튀었다. 이제 `css/base.css` 의 `:root` 에 있는 변수 **세 개만** 쓴다.
  - `--frame`(내용 폭, 1400px) · `--gutter`(좌우 여백, 32px / 640px 이하 16px) · `--frame-max`(= `--frame` + `--gutter` × 2).
  - **새 페이지·섹션에 자체 `max-width` 를 넣지 않는다.** 아래 세 방식 중 하나를 쓰며, 셋 다 왼쪽 끝이 로고와 같은 x 에 온다.
    1. **화면 끝까지 배경이 닿는 막대·카드** (`.topnav`·`.backnav`·`.weavo-grid-wrap`·`.project-list-view`·`.artwork-stage`·`.profile-section`): 좌우 `padding` 또는 `margin` 을 `max(var(--gutter), calc((100% - var(--frame)) / 2))` 로 준다.
    2. **보통 컨테이너** (`.artworks-page`·`.artists-page`·`.exhibitions-page`·`.network-page`·`.legal-page`·`.project-head`·`.profile-head`·`.projects-grid`·`.artworks-grid`·`.carousel-header`·`.carousel-track-wrap`·`.recent-activity`·`.artwork-breadcrumb`·`#collectionItemsGrid`): `max-width:var(--frame-max); margin:0 auto; padding-inline:var(--gutter)`.
    3. **이미 여백이 있는 부모 안의 요소** (`.hero-inner`·`.stats-bar-inner`): `max-width:var(--frame)` 만.
  - **글만 있는 페이지는 유일한 예외다** (소개·개인정보처리방침·면책조항·계정 삭제·404). 760px 읽기 폭을 1400px 프레임 왼쪽에 붙이면 넓은 모니터에서 오른쪽이 휑해 보이므로 **가운데 정렬**한다: `max-width:calc(760px + var(--gutter) * 2); margin:0 auto`. 좌우 여백은 그대로 `--gutter` 를 쓰고, 모바일에서는 화면이 좁아 자동으로 로고 선과 맞는다. (2026.9.11 사용자 피드백)
  - **관리자 페이지는 글 페이지가 아니라 도구라서 프레임 전체를 쓴다** (2026.9.11). `.admin-page{max-width:var(--frame-max)}` 에 왼쪽 탭 레일 190px + 내용 열(`.admin-layout` 그리드) 구조이며, 로고와 맞는 것은 `h1` 과 탭 레일의 왼쪽 끝이다. 본문 글줄은 `.admin-help{max-width:78ch}` 로 따로 잡는다.
  - 모바일은 `--gutter` 가 16px 로 바뀌어 자동 처리되므로 미디어 쿼리에 16px 을 새로 적지 않는다. 캠페인·네트워크의 휴대폰 전체 화면 모드(`body[data-mobile-fs]`)만 여백 0 인 의도된 예외다.
  - **확인 방법**: 화면 폭 2560 / 1280 / 768 / 375 에서 `.logo` 의 left 와 그 페이지 본문 첫 요소의 left 가 같아야 한다(카드류는 카드 바깥 테두리 기준). 가로 스크롤이 생기지 않아야 한다.
- **앱·브라우저가 닫혀 있을 때의 알림은 웹 푸시로 보낸다** (2026.9.11, `supabase_push.sql`). 기존 알림 피드(`notifications` 테이블 + 종 아이콘)는 Supabase Realtime 이라 **페이지가 열려 있을 때만** 닿는다 — 그래서 앱을 내리면 아무것도 오지 않았다. 경로는 한 줄이다: `notifications` INSERT → `pg_net` 이 Edge Function 주소로 `{id}` POST → `supabase/functions/push/index.ts` 가 `claim_push(id)` 로 행을 선점하고 기기별로 암호화 발송 → 루트 `sw.js` 가 표시. **엔드포인트에 비밀값을 두지 않는 이유**는 `claim_push` 가 읽는 문장 안에서 `pushed_at` 을 찍어 같은 알림이 두 번 나가지 않고, 행에 적힌 수신자 외에는 누구에게도 갈 수 없기 때문이다(그래서 `--no-verify-jwt`). VAPID 공개 키·함수 주소는 공개값이라 `site_settings` 에 두고(16절), **비밀 키는 Supabase 비밀값에만 둔다**(3절). 메시지 언어는 `push_subscriptions.lang`·`push_tokens.lang`(등록한 기기의 언어)로 정한다 — 계정별 언어 설정이 없다.
  - **앱(Flutter WebView)은 Web Push API 가 없어 FCM 으로 받는다** (2026.9.12, `supabase_push_tokens.sql`). 트리거·디스패치·Edge Function 은 **그대로 하나**를 쓰고, `claim_push` 가 브라우저 구독과 앱 토큰을 함께 돌려주면 함수가 양쪽으로 보낸다. 토큰은 `js/push.js` 가 `window.WeavoAppBridge.call('GET_PUSH_TOKEN')` 으로 받아 `save_push_token` 에 넣고, 앱이 토큰을 갱신하면 보내는 `weavoapp` 이벤트에서도 다시 넣는다. 로그아웃 직전(`auth.js` `signOut`)에 그 기기 행을 지운다 — 공용 휴대폰에서 이전 계정 알림이 계속 가는 것을 막는다. 문구는 웹과 같은 `TEXT` 표를 쓰고, 앱이 읽는 값은 `notification.title/body` 와 `data.url`(반드시 `https://weavo.art` 로 시작)·`data.badge`(미읽음 수, 문자열) **셋뿐이다 — 형식은 앱 코드 기준이니 바꾸지 않는다.** FCM 자격 증명은 `FCM_SERVICE_ACCOUNT` 시크릿 하나이고, 없으면 앱 발송만 건너뛴다.
  - **푸시 제목은 문장이 아니라 짧은 이름표다** (2026.9.12). iOS 는 제목을 한 줄로 자르는데, 예전에는 네 종류가 모두 "{이름}님이 회원님의…" 로 시작해 **무슨 알림인지 말해 주는 부분이 잘려 나가** 잠금 화면에서 좋아요와 댓글이 똑같아 보였다. 이제 제목은 `좋아요 · 작품이름` 처럼 **이름표 + 작품 이름**이고(팔로우는 이름표만), 누가 무엇을 했는지는 줄이 넘어가도 되는 본문이 맡는다(댓글·답글은 `이름: 내용`). 작품 이름은 `claim_push` 가 함께 돌려준다. 문구를 바꿀 때 이름표를 다시 문장으로 만들지 않는다 — 앞이 잘리면 종류를 알 수 없게 된다. 브라우저 알림도 같은 표를 쓴다.
  - **앱 아이콘 배지는 두 곳에 함께 보낸다** (2026.9.12). `data.badge`(문자열)는 앱 코드가 직접 읽는 값이라 **앱이 살아 있을 때만** 동작하고, 완전히 종료된 상태에서는 읽을 주체가 없어 배지가 붙지 않았다. 시스템이 앱을 깨우지 않고 배지를 다는 것은 `apns.payload.aps.badge` 와 `android.notification.notification_count`(둘 다 **숫자**)뿐이다. 둘 다 보내야 켜져 있을 때와 꺼져 있을 때가 모두 덮인다. 미읽음이 0 이어도 그대로 보낸다 — iOS 는 0 을 받아야 배지를 지운다.
  - **FCM 응답이 `INVALID_ARGUMENT` 라고 토큰을 지우지 않는다** — 메시지 본문이 잘못돼도 같은 코드가 오기 때문에, 한 번의 형식 실수로 토큰 테이블 전체가 지워질 수 있다. 폐기는 404 / `UNREGISTERED` 에서만 한다.
- **모바일 확대는 더블탭만 끄고 핀치는 살려 둔다** (2026.9.12). `body{touch-action:manipulation}` — 실수로 커지는 건 대부분 더블탭이고, 덤으로 탭 반응이 300ms 빨라진다. **`user-scalable=no`·`maximum-scale=1` 은 쓰지 않는다** — iOS Safari 가 무시하는 데다 WCAG 1.4.4(텍스트 200% 확대)에 어긋나고, 장애인 아티스트가 쓰는 서비스라 특히 맞지 않는다. 뷰포트는 `viewport-fit=cover` 로 배경이 노치까지 닿게 하고, 내용은 `env(safe-area-inset-*)` 로 비켜 둔다(`.app` 좌우, `.topnav` 위, `#legal-footer` 아래, 전체 화면 모드의 떠 있는 조작부). iOS 홈 화면 추가용 `apple-mobile-web-app-capable` 도 모든 페이지에 있다.
- **`overscroll-behavior:contain` 은 "항상 자기 스크롤이 있는" 요소에만 건다** (2026.9.12, 회귀 겪고 확정). `.main-scroll` 은 `overflow-y:auto` 라 스크롤 컨테이너로 취급되지만 대부분의 페이지에서는 내용이 다 들어가 **스크롤할 것이 없고, 휠·터치는 문서로 전파돼야 한다.** 여기에 `contain` 을 걸었더니 전파가 막혀 PC 에서 마우스 휠이 아예 죽었다. pull-to-refresh 를 막는 것은 **뷰포트(`html,body{overscroll-behavior:none}`)** 이고 그것으로 충분하다. 대화상자·메뉴·댓글 목록처럼 뒤 페이지로 넘기지 않는 것이 목적인 요소에만 `contain` 을 쓴다.
- **리로드는 막는 것보다 견디는 쪽이 확실하다** (2026.9.12). iOS 는 pull-to-refresh·메모리 압박·WebView 호스트의 새로고침 제스처로 페이지를 다시 불러오고, 그중 CSS 로 막을 수 있는 것은 일부뿐이다. 그래서 잃으면 아픈 상태를 저장한다 — 프로필 수정 중이던 값은 `pagehide`·`visibilitychange` 에서 `sessionStorage` 에 넣고(`wasOpen` 표시) 다음 로드에 대화상자를 다시 열며, 캠페인 줌·팬은 캠페인별로 기억했다가 격자를 다 그린 뒤 되돌린다. **되돌리기 전에 초기화 값이 저장돼 덮어쓰지 않도록** `msRestoring` 으로 저장을 잠근다(이 순서를 빠뜨려 한 번 실패했다).
- **모달이 열린 동안에는 뒤쪽 페이지를 얼려 둔다** (2026.9.12). `.main-scroll` 이 스크롤러인 페이지는 `base.css` 의 `:has()` 규칙이, 문서가 스크롤러인 페이지는 `common.js` 의 MutationObserver 가 `body.modal-open`(`position:fixed`)과 `top:-Npx` 로 처리하고 닫을 때 스크롤 위치를 되돌린다. `classList.add('open')` 호출 지점이 열 곳 넘게 흩어져 있어 감시 방식을 골랐다 — **관찰자 콜백에서 rAF 로 미루지 않는다**(탭이 숨겨져 있으면 rAF 가 돌지 않아 잠금이 걸리지 않는다. 실제로 그렇게 만들었다가 고쳤다).
- **스크롤되는 요소에는 `overscroll-behavior` 를 준다 — 안 주면 iOS 가 페이지를 새로고침한다** (2026.9.12). 인 스크롤러가 끝에 닿은 뒤의 당김은 기본적으로 문서로 전파되고(scroll chaining), iOS 는 그것을 pull-to-refresh 로 읽어 **페이지를 리로드**한다. 리로드는 메모리에 있던 것을 전부 날린다 — 열려 있던 프로필 수정 창과 입력하던 내용, 캠페인의 줌·팬, "더 보기" 로 불러온 목록. 새 스크롤 컨테이너를 만들면 `css/base.css` 의 pull-to-refresh 블록 목록에 선택자를 추가한다(이유를 한 곳에 모아 두려고 다른 파일 선택자도 거기에 적는다). 모달이 열린 동안 뒤쪽 스크롤은 `body:has(.modal-overlay.open) .main-scroll` 로 잠근다 — `classList.add('open')` 호출 지점이 흩어져 있어 JS 대신 `:has()` 를 썼다. **주의: 문서(`<html>`)가 스크롤러인 페이지에서는 이 잠금이 적용되지 않는다** — 그쪽까지 막으려면 스크롤 위치를 저장·복원하는 JS 가 필요하다(미구현).
- **공유·색인되는 상세 페이지(작품·프로필·전시)의 "뒤로" 는 `setupBackLink()`(common.js)로 건다** (2026.9.12). 마크업의 `href` 는 밖에서 바로 들어온 방문자를 위한 실제 목적지(그 작품의 캠페인, 캠페인 목록)로 두고, 같은 사이트에서 넘어온 경우에만 `history.back()` 으로 가로챈다. 판단은 `cameFromThisSite()` — same-origin `document.referrer` **와** `history.length > 1` 을 함께 본다(새 탭으로 연 링크는 referrer 가 있어도 돌아갈 기록이 없어 그냥 멈춘다). Ctrl/Cmd 클릭은 가로채지 않으므로 새 탭 열기가 그대로 동작하고, 프로필의 `stopGraph()` 처럼 떠날 때만 할 일은 콜백으로 넘긴다.
- **작품을 격자로 보여주는 화면은 클릭 시 라이트박스로 연다** (홈·프로필·컬렉션·캠페인·작품 탐색, 2026.9.11 에 작품 탐색 추가). 카드의 `href` 는 작품 상세 주소 그대로 두고 평범한 좌클릭만 `preventDefault()` 로 가로채 `openLightbox(sub)` 를 부른다 — 크롤러·가운데 클릭·Ctrl 클릭은 여전히 색인되는 실제 주소로 간다. 목록 조회는 `ARTWORK_ROW_COLS`(common.js)를 써서 라이트박스가 필요한 설명·링크·재료까지 한 번에 받는다(행당 약 +200바이트). 새로 만드는 작품 격자도 같은 방식을 쓴다.
- UI 디자인 작업에는 `.claude/skills/superdesign` 스킬이 있다. 이 스킬은 외부(GitHub raw) 지침을 가져오므로, 디자인 작업을 명시적으로 요청받았을 때만 쓴다.

---

## 8. 문서 규칙 (필수)

- 개발 문서·리포트·계획서는 **`DevDocs/`** 에만 만든다. 루트나 `en/`·`ko/` 에 두지 않는다 (루트는 배포 루트 — 3절).
- 파일은 **HTML(`.html`) 자체 완결형**으로 쓴다 — 외부 CDN·스크립트·폰트 없이 CSS/JS 인라인. 파일 이름 끝에 `_YYYYMMDD` 를 붙인다 (예: `ProjectOverview_20260908.html`).
- **문서 언어·테마 (2026.9.11 확정 — 사용자 지시로 2026.9.8 규칙을 대체)**
  - **한국어가 기본**이다. 문서를 열면 한국어가 먼저 보인다.
  - **영어는 번역본**으로 같은 문서 안에 함께 넣고, 전환 버튼(EN / 한국어)으로 바꿔 본다. 영어·한국어 파일을 따로 만들지 않는다. 본문 전체를 `<main class="ko">` / `<main class="en">` 두 벌로 두고 CSS 로 한쪽만 보인다.
  - **라이트(화이트)·다크(블랙) 테마**를 모두 갖추고 전환 버튼으로 바꾼다. 저장된 선택이 없으면 OS 설정(`prefers-color-scheme`)을 따르고, 색은 전부 CSS 변수(`--bg`, `--ink`, `--line` …)로 정의해 `html[data-theme="dark"]` 에서 값만 바꾼다.
  - **언어·테마 전환 버튼은 스크롤해도 항상 보여야 한다.** 상단 바를 `position: sticky` 로 고정하고 오른쪽 끝에 두 버튼을 둔다. 문서 맨 위에만 있어서 스크롤하면 사라지는 방식은 금지.
  - 선택한 언어·테마는 `localStorage`(`weavoDocLang`, `weavoDocTheme`)에 기억하고, `?lang=ko|en` / `?theme=light|dark` 쿼리로도 지정할 수 있게 한다. JS 가 꺼져 있어도 한국어와 라이트 테마는 보여야 한다 (CSS 만으로 기본 표시).
  - 구현 기준: `DevDocs/SecurityReview_20260911.html` 의 상단 바·`.ko`/`.en` 전환·테마 변수·하단 스크립트를 그대로 따른다. (2026.9.8 이전 문서인 `ProjectOverview_20260908.html` 은 영어 기본의 옛 형식이며, 손댈 때 이 규칙으로 바꾼다.)
- `README.md` 는 영어로 쓰고 끝에 한국어 요약 절을 둔다.
- 장비·제품 배포용 매뉴얼 폴더는 이 저장소에 없다. `SEO_DEPLOYMENT_CHECKLIST.md` 는 기존 위치(루트)에 그대로 둔다.

---

## 9. 버전 · 변경 이력

- **버전 번호 체계는 없다.** 공통 규칙의 "버전은 병합 시점에 매긴다" 항목은 건너뛴다.
- **변경 이력 파일: `DevDocs/DevLog.txt`** (2026.9.9 신설). 코드나 문서를 수정한 커밋마다 **반드시** 여기에 한 줄을 추가한다. (작업은 `main` 에서 직접 하므로 공통 규칙의 "브랜치에서는 조각 파일" 절차는 해당 없음)
  - 날짜별 구분(`========== YYYY-MM-DD ==========`), **최신 날짜가 위**, 같은 날짜 안에서는 **최근 작업이 위**.
  - **이슈마다 한 줄, 80자 이내, 한 가지 내용만.** 접두어 `feat:`(새 기능) / `fix:`(수정) / `chore:`(정리·문서·설정). 사용자 관점으로 쓴다.
  - 계속 갱신되는 기록이므로 파일 이름에 `_YYYYMMDD` 를 붙이지 않는다 (8절 문서 규칙의 예외).
- 커밋 메시지는 `Weavo: <요약>` 형식(한국어, 한 줄 요약 + 필요하면 본문). `asdf` 식 메시지는 쓰지 않는다.

---

## 10. 검증 방법 (표준 처리 순서 9단계 "빌드·검증" 에 해당)

- **빌드 단계는 없다.** 대신 아래를 한다.
  1. 수정한 JS: `node --check <파일>` 로 문법 확인.
  2. 페이지·Function 동작: `npx wrangler pages dev .` 로 로컬 서빙 후 브라우저에서 확인 (Functions·`_redirects`·`_headers` 까지 같이 동작). Function 이 필요 없는 페이지는 HTML 파일을 직접 열어도 된다.
  3. `en/`·`ko/` 양쪽 페이지를 모두 열어 본다 (4절).
- `node_modules/` 는 `package.json` 없이 **git 에 커밋돼 있다** (wrangler 실행용). 건드리지 않는다. 패키지를 추가·갱신할 일이 있으면 사용자에게 먼저 확인한다.
- `.wrangler/` 는 `.gitignore` 에 있다 (로컬 계정 캐시). 커밋하지 않는다.

---

## 11. 작업 시 반드시 확인

- [ ] `en/`·`ko/` 쌍을 모두 고쳤는가? i18n 키를 양쪽에 넣었는가?
- [ ] 상세 페이지 메타를 바꿨다면 Function 과 클라이언트 폴백을 모두 고쳤는가?
- [ ] DB 변경이 있다면 SQL 파일을 남겼고, 실행 순서를 보고에 적었는가?
- [ ] 새 파일이 루트에 생겼다면 웹에 공개돼도 되는 파일인가?
- [ ] JS/CSS 를 고쳤다면 `?v=` 자산 버전이 올라갔는가? (12절 — 훅이 자동으로 하지만 확인)
- [ ] 새 페이지·섹션에 자체 `max-width` 를 넣지 않고 공용 프레임(`--frame`/`--gutter`/`--frame-max`)을 썼는가? 로고와 세로줄이 맞는가? (7절)
- [ ] 작품을 여러 건 한꺼번에 삭제하는 코드·SQL 이 들어가지 않았는가? (13절)
- [ ] `DevDocs/DevLog.txt` 오늘 날짜 아래에 이슈별 한 줄(80자 이내)을 추가했는가? (9절)
- [ ] DB 전송량·요청 수·월 한도 영향을 코드 수정 전에 계산해 보고에 적었는가? (15절)
- [ ] 새 옵션·동작 토글을 만들었다면 관리자 페이지 "사이트 옵션" 에서 설정할 수 있는가? (16절)
- [ ] push 를 지시받지 않았다면 push 하지 않았는가?

---

## 12. JS/CSS 캐시 무력화 — `?v=` 자산 버전 (2026.9.9 확정)

- `/js/*`·`/css/*` 는 `_headers` 에서 **1년 immutable** 로 캐시된다. 대신 모든 페이지의 `<script src>`·`<link href>` 에 `?v=YYYYMMDD-HHMMSS` 버전 쿼리가 붙어 있어, **URL 이 바뀌면 캐시가 새 파일을 받는다.** 배포 시점에 URL 이 바뀌므로 4시간 캐시 지연·파일 섞임(새 `auth.js` + 옛 `ko.js`) 문제가 사라진다.
- **JS 나 CSS 를 고친 커밋에는 반드시 버전을 올린다**: `node tools/bump-asset-version.js` 가 `en/*.html`·`ko/*.html` 의 링크 전부를 같은 새 값으로 바꾼다. 날짜가 아니라 **초 단위**라 하루에 여러 번 배포해도 값이 겹치지 않는다.
- 이 실행은 **pre-commit 훅이 자동으로** 한다 (`tools/git-hooks/pre-commit` — 스테이징에 `js/`·`css/` 파일이 있을 때만 실행하고 HTML 을 다시 스테이징). 훅은 저장소에 들어 있지만 git 이 자동으로 켜 주지 않으므로 **새 clone 마다 한 번**:

```bash
git config core.hooksPath tools/git-hooks
```

- HTML 만 고친 커밋은 버전을 올리지 않는다 (HTML 은 `no-cache`).
- **배포 전환 순간의 캐시 오염 주의 (2026.9.10 실제 발생)**: push 직후 몇십 초 동안은 새 HTML 이 새 `?v=` 로 JS 를 요청해도 옛 파일이 내려올 수 있고, 그 옛 파일이 새 주소로 1년 캐시된다(PC 에서 히어로 숫자가 전부 0). 그래서 **파일 간 새 함수·반환값에 의존하는 코드는 옛 파일과 섞여도 죽지 않게** 쓴다(존재 검사·폴백·try/catch). 이미 오염된 브라우저는 다음 배포(새 `?v=`)나 강력 새로고침으로 풀린다. 새 페이지를 만들 때는 링크에 `?v=` 가 있는지 확인하고 없으면 스크립트를 한 번 돌린다.
- `tools/` 는 저장소에 있지만 `functions/tools/[[path]].js` 가 웹 접근을 404 로 막는다 (2026.9.10).

---

## 13. 작가 작품 보호 — 일괄 삭제 기능 금지 (필수 · 2026.9.9 확정)

- **관리자라 하더라도 작가들의 작품을 한꺼번에 삭제할 수 있는 기능은 만들지 않는다.** 화면 버튼, RPC, `supabase_*.sql` 스크립트, 콘솔용 스크립트 어느 형태로도 넣지 않는다. 금지 예: "캠페인의 모든 작품 삭제", "특정 작가의 모든 작품 삭제", 다중 선택 후 일괄 삭제, 캠페인 삭제 시 작품까지 cascade 삭제.
- **개별 작품을 한 건씩 삭제하는 기능은 문제없다.** 신고가 들어오는 등 사유가 있을 때 작품 하나를 확인하고 지우는 용도이며, 기존 기능(라이트박스의 삭제 — 작가 본인 또는 관리자, 신고 처리)은 그대로 유지한다.
- **캠페인 삭제는 작품을 지우지 않는다.** `delete_mosaic_project()` 와 `mosaic_submissions` 의 FK(`on delete set null`)는 작품을 풀로 돌려보내도록 설계돼 있다 (`supabase_mosaic_project_delete.sql`). 이를 cascade 삭제로 되돌리는 변경은 금지.
- DB 쪽도 같은 원칙을 지킨다: `mosaic_submissions` 의 delete 정책은 "작가 본인 또는 관리자가 행 단위로" 지우는 것만 허용한다. 여러 행을 한 번에 지우는 RPC·정책·트리거를 추가하지 않는다.
- 작가 본인이 작품 하나를 지울 때 그 작품의 조각 행이 `parent_id` cascade 로 함께 지워지는 것은 본인 작품의 일부이므로 이 절에 어긋나지 않는다.
- 유일한 예외는 **본인의 계정 삭제**(`delete_own_account`) — 사용자가 자기 계정을 지우면서 자기 작품이 함께 삭제되는 것은 본인 의사이므로 허용. 관리자가 남의 계정을 삭제하는 기능은 없고 만들지 않는다.
- **예외 하나 — 관리자 페이지 "작품" 탭의 선택 삭제 (2026.9.11 사용자 승인).** 음란물·스팸 대량 업로드 대응 수단이 필요하다는 판단으로, 아래 안전장치를 모두 갖춘 형태로만 허용한다. 안전장치를 빼는 변경은 이 승인 범위 밖이다.
  - **한 번에 최대 20건** (`ADMIN_BULK_MAX`, js/admin.js). "전체 선택" 도 20건에서 멈춘다.
  - 삭제 전 **확인 문구 입력**(`confirmDialog` 의 `confirmText`).
  - **DB 에는 여전히 대량 삭제 RPC·정책이 없다.** 클라이언트가 기존 행 단위 delete 정책으로 **한 건씩** 지운다. `supabase_admin_moderation.sql` 에도 그런 RPC 를 넣지 않았다 — 넣지 말 것.
  - 삭제할 때 **Storage 원본 이미지 파일까지** 지운다(음란물 대응에서 행만 지우면 파일 URL 이 그대로 살아 있다).
  - 모든 삭제를 **`admin_audit_log` 에 한 건씩 기록**한다(추가 전용 — update/delete grant 없음).
- 댓글에는 이 절이 적용되지 않는다. 관리자 페이지 "댓글" 탭의 선택 삭제도 같은 20건 상한·확인 문구·기록을 쓰지만, 댓글은 작가의 작품이 아니다.
- 이 규칙과 충돌하는 요청을 받으면 구현 전에 이 절을 근거로 사용자에게 먼저 확인한다.

---

## 14. 관리자 페이지 `/{lang}/admin` (2026.9.9)

- **화면은 왼쪽 탭 레일 + 패널 구조다** (2026.9.11). 탭은 대시보드(방문 통계 → 사용량) · 신고 · 작품 · 댓글 · 캠페인 · 작품 처리(풀 대기·조각·썸네일) · 회원(관리자 목록·업로드 차단) · 공지 · 사이트 옵션 · 기록. **탭을 처음 열 때만 그 탭의 데이터를 읽는다**(예전에는 진입하자마자 9개 요청이 한꺼번에 나갔다). 현재 탭은 주소 해시(`/ko/admin#artworks`)에 남아 새로고침·북마크에도 유지된다. 새 관리 기능은 새 `<section>` 을 알맞은 패널 안에 넣고 `ADMIN_TAB_LOADERS` 에 로더를 건다.
- 파일: `en/admin.html`·`ko/admin.html`(about.html 셸 복제), `js/admin.js`, `css/admin.css`. 헤더의 "관리" 링크는 `auth.js` 의 `updateIdentityUI()` 가 `is_admin` 계정에만 동적으로 만든다(30개 헤더에 숨은 요소를 두지 않기 위해).
- 접근 제어는 이중이다: 화면은 `me.isAdmin` 이 아니면 안내문만 보이고, 데이터는 DB 정책(`reports` 관리자 전용, `delete_mosaic_project` 관리자 검사)이 막는다. 화면 가림만 믿고 정책을 느슨하게 하지 않는다.
- 기능: 신고 목록(대상 링크로 열어 한 건씩 검토, 상태 변경만), 캠페인 목록·제목/설명 수정·격자 이미지 생성·공유 이미지 생성(각각 없는 옛 캠페인만)·개별 삭제(작품은 풀로 복귀하고 곧바로 매칭을 돌려 남은 캠페인에 배치; 크기·이미지 변경은 캠페인 페이지의 reshape), 풀 대기 작품 목록과 "지금 배치" 버튼(매칭 수동 실행), 작품 썸네일 누락 수와 "썸네일 생성"(재생성), 작품 조각(조각 없는 작품 수·"조각 생성"·"전체 다시 생성" — `supabase_mosaic_pieces.sql`), 관리자 목록(지정·해제는 SQL 안내만), DB·Storage 사용량, 방문 통계(오늘·최근 10일 회원/게스트 방문 수 누적 막대그래프와 신규 작품·회원 — `supabase_visit_stats.sql`, `js/auth.js` 의 `recordVisitOnce()` 가 브라우저당 하루 1회 기록), 사이트 옵션 체크박스(16절). 작품 목록(최신순·기간/작가 필터·체크박스 선택 삭제 — 13절의 승인된 예외, 20건 상한·확인 문구·Storage 원본 파일 삭제·기록), 댓글 목록(최신순·체크박스 선택 삭제), 업로드 차단(사용자 이름 검색 → 차단/해제, `admin_set_upload_blocked`), 기록(관리자 삭제·차단 이력 200건, 추가 전용) — 모두 `supabase_admin_moderation.sql` 이 필요하다. **13절의 안전장치를 빼거나 대량 삭제 RPC 를 추가하지 않는다.**
- **전체 공지 (2026.9.13, `supabase_admin_broadcast.sql`)** — "공지" 탭에서 제목(80자)과 내용(500자)을 써서 **모든 회원에게 알림 한 건**을 보낸다. 알림 종에 쌓이고 푸시를 켠 기기에는 바로 뜬다. **되돌릴 수 없으므로**(행이 생기는 순간 트리거가 이미 발송했다) ⓐ 확인 문구 입력, ⓑ 휴대폰에 실제로 어떻게 보이는지 미리보기(제목은 한 줄에서 잘린다 — 7절의 푸시 문구 규칙과 같은 이유), ⓒ 발송 대상 수 표시, ⓓ 발송 중 버튼 잠금(같은 공지가 두 번 나가면 회수할 수 없다), ⓔ `admin_audit_log` 기록을 모두 둔다. 길이 제한은 화면과 RPC **양쪽**에서 막는다 — anon 키로 RPC 를 직접 부를 수 있기 때문이다. 발송은 회원 수만큼 Edge Function 을 부르므로(회원 34명 → 34회, 월 한도 200만) 지금 규모에서는 문제가 없지만, 회원이 수만 명이 되면 한 번에 전체 기기를 읽는 방식으로 바꾼다.
- `robots.txt` 색인 제외, `sitemap-static.xml` 미등재, `<meta name="robots" content="noindex,nofollow">`. 새 관리자 기능도 같은 원칙으로 이 페이지에 모은다.

---

## 15. DB 사용량·전송량 사전 검토 (필수 · 2026.9.10 확정)

- **Supabase 요금제: Pro Plan** (2026.9.10 대시보드 Organization → Usage 화면으로 확인 — 사용자 제공). 청구 주기는 매월 5일 시작(예: 2026.9.5 ~ 10.5). **월 한도**: Egress(DB·Auth·API 응답 전송량) 250GB · Cached Egress(Storage CDN 을 거친 이미지 전송량 — `/img/` 프록시가 엣지 캐시 미스 때 받아오는 양) 250GB · Storage 100GB · MAU 100,000 · Realtime 동시 접속 500 / 메시지 500만 · Edge Function 호출 200만 · 이미지 변환 100회 · Compute 크레딧 $10(Micro 프로젝트 1개분). **Spend Cap 켜짐** — 한도를 넘으면 추가 과금 대신 기능 제한이 걸린다(Usage 화면 문구 "you are currently not billed for overages"). DB 디스크 용량은 Usage 화면에 없어 미확인(공식 요금표상 Pro 기본 8GB/프로젝트 — 프로젝트 Settings → Compute and Disk 에서 확인). **관리자 페이지 "대시보드 → 사용량" 이 DB·Storage 를 이 한도와 비교한 사용률로 보여준다** (2026.9.12; 한도는 사이트 옵션 `dbLimitGb`·`storageLimitGb`). 전송량은 DB 에서 읽을 수 없어 여전히 대시보드에서만 확인한다. **이 절의 30% 기준은 전송량 월 75GB** 다.
- 사용량 실측(2026.9.5~9.10, 5일): Cached Egress 1.69GB · Egress 0.27GB · Storage 0.35GB · MAU 21 · Realtime 동시 접속 최대 6 — 모두 한도의 1% 미만. Compute 248시간(하루 48시간 = 프로젝트 2개 × 24시간).
- **조직에 프로젝트가 2개다** (2026.9.10 사용자 확인): Weavo 가 쓰는 `kzvheplmtzjmzcxjkxub` 와, Weavo 사이트가 쓰지 않는 `plants`(`zvrbajyulwguzboilnkj`, Nano, Tokyo, 하루 20여 요청). 공식 문서상 유료 조직의 Nano 는 Micro 와 같은 값($0.01344/h ≈ 월 $10)으로 과금되고, $10 크레딧은 프로젝트 1개분이며, Compute 는 Spend Cap 적용 대상이 아니다 → `plants` 를 켜 두는 동안 월 약 $10 이 추가 청구된다. 줄이는 방법은 일시 정지(정지 중엔 과금 없음)·Free 조직으로 이전(무료 2개 한도, 1~2분 중단)·삭제이며 사용자 결정 사항. Weavo 코드·DB 와는 관계없다.
- **개발 지시를 받으면 코드를 고치기 전에 아래를 먼저 계산해 보고한다** (표준 처리 순서 1~2단계에 포함). 보고에 "DB 사용량 영향" 항목을 반드시 둔다.
  1. **페이지 뷰 1회당** DB 에서 받는 행 수·바이트·요청 수 — 현재값 → 변경 후.
  2. **사용자 동작 1회당**(업로드·매칭·reshape·삭제·알림) 전송량과 요청 수. 특히 다른 사용자의 동작마다 반복되는 다운로드(예: 업로드 때 빈 칸 전체 조회)에 주의.
  3. 예상 트래픽(일 뷰 수)을 곱해 **월 전송량**을 추정하고 요금제 한도와 비교한다. **한도의 30% 를 넘길 수 있으면** 설계를 바꾸거나 사용자에게 먼저 확인한다.
  4. 행 수가 커질 수 있는 조회(캠페인 칸·작품·댓글·알림)는 **상한이 있는지**, 1,000행을 넘으면 `fetchAllRows` 를 쓰는지, 불필요한 조인·컬럼을 받지 않는지.
  5. 자주 읽고 잘 안 바뀌는 데이터(기준 격자, 썸네일)는 DB 조회 대신 **Storage + `/img/` 프록시(엣지 캐시)** 로 내보낼 수 있는지.
- 기준 수치(2026.9.9 실측): 4,988칸 캠페인 상세 1회 ≈ 0.7MB·16요청. 30,000칸이면 ≈ 5MB — 하루 1,000뷰에 5GB/일 ≈ 월 150GB 로 Pro 한도(250GB)의 60%, 이 절의 30% 기준을 넘는 규모. (2026.9.10 부터는 격자 PNG + `/img/` 엣지 캐시로 칸 데이터가 DB 전송량을 거의 쓰지 않는다 — 7절)
- 캠페인 크기 제한(칸 ≤ 10,000)·Max rows 같은 상한을 풀 때는 이 절의 계산을 먼저 한다.

## 16. 사이트 옵션 — 모든 옵션은 관리자 화면에서 설정 (필수 · 2026.9.10 확정)

- **화면 표시나 기능 동작을 켜고 끄는 옵션은 예외 없이 관리자 페이지 `/{lang}/admin` 의 "사이트 옵션" 섹션에서 설정할 수 있게 만든다.** JS 상수·하드코딩 플래그·환경변수처럼 배포해야만 바뀌는 옵션은 만들지 않는다. (사용자 지시 2026.9.10)
- 저장소: Postgres 단일 행 테이블 `site_settings`(`id=true` 한 행, `settings jsonb`) — `supabase_site_settings.sql`. 누구나 읽고(anon 포함) 쓰기는 `admin_set_site_settings(p_patch jsonb)` RPC(관리자 검사, 키 병합, 값이 `null` 이면 키 삭제 = 기본값 복귀)로만 한다. 직접 update grant 는 없다.
- 기본값은 **`js/common.js` 의 `SITE_SETTING_DEFAULTS` 한 곳**에만 둔다. DB 행에는 관리자가 바꾼 키만 저장되므로 옵션을 추가해도 SQL 을 다시 실행할 필요가 없다.
- 옵션 하나를 추가하는 절차 (세 곳):
  1. `SITE_SETTING_DEFAULTS` 에 키와 기본값 (camelCase, 예: `showCampaignPreview: false`).
  2. `en/admin.html`·`ko/admin.html` 의 `#adminSettings` 에 `<input type="checkbox" data-setting="키" disabled>` 체크박스 한 줄씩 (문구는 HTML 에 언어별로 직접 — 4절). `admin.js` 가 `data-setting` 을 자동으로 묶어 읽고 저장한다. 숫자 옵션은 `type="range"`(또는 `number`)에 `min`·`max` 를 두면 같은 방식으로 묶이고, 문자열 옵션은 `type="text"`·`type="url"`(클래스 `admin-text`)로 묶여 포커스를 잃을 때 저장되고, 색 옵션은 `type="color"`(값 `#RRGGBB`)로 묶이며, 옆의 `<output data-setting-output="키">` 에 값이 표시된다 (2026.9.10, `previewContrast`·`previewTint`).
  3. 기능 코드에서 `getSiteSettings().then(s => …)` 로 읽는다. 절대 거부(reject)하지 않고 테이블이 없거나 오프라인이면 기본값을 준다. 페이지당 1회 조회, `sessionStorage` 60초 캐시, 관리자 자신의 저장은 캐시를 즉시 갱신한다.
- 서버에서도 강제해야 하는 옵션(예: 업로드 잠금)은 RLS 정책·RPC 안에서 같은 `site_settings` 행을 읽어 검사한다. 화면 가림만으로 끝내지 않는다.
- 현재 옵션: `showCampaignPreview` — 캠페인 페이지 오른쪽 "미리보기" 썸네일 표시, 기본 꺼짐.
- 현재 옵션: `countVisits` — 방문자 수 집계(브라우저당 하루 1회, 회원/게스트 구분), 기본 켜짐. `record_visit()` 이 서버에서도 검사한다.
- 현재 옵션: `previewContrast`(대비 0~100, 기본 40)·`previewBrightness`(밝기 0~100, 기본 70)·`previewTint`(틴트 색 `#RRGGBB`, 기본 `#DCE4ED`) — 빈 칸 회색. `openCellGrayer(cells, settings)`(common.js)가 캠페인 기준 사진의 평균 명도를 밝기 수준으로 옮기고 편차를 대비만큼 줄이며, `openCellPainter()` 가 그 회색에 틴트 색의 채널별 비율(색조·채도만, 밝기는 쓰지 않음)을 곱해 `rgb()` 문자열로 돌려준다. 무채색 틴트는 순수 회색. 홈·캠페인 카드·캠페인 격자·공유 카드·관리자 미리보기가 모두 이 함수로 그린다. 공유 카드는 만들 때의 값이 구워지므로 바꾼 뒤에는 관리자 캠페인 목록의 "공유 이미지 다시 생성" 으로 다시 만든다 (2026.9.10).
- 현재 옵션: `pieceGrid`(작품 분할 개수 2~12, 기본 7)·`pieceMatchDistance`(조각 색 일치 기준 5~60, 기본 20) — 조각은 `makeArtworkPieces()`(common.js)가 옵션대로 자르고, 서버 매칭 RPC 가 `site_settings` 를 직접 읽어 기준을 강제한다(`supabase_mosaic_pieces.sql`). 분할 개수 변경은 새 업로드부터 적용되고 기존 작품은 관리자 "전체 다시 생성" 으로 바꾼다. 색 기준 변경은 새 업로드부터 적용되며, 기존 조각까지 즉시 맞추려면 옵션 옆 "색 기준 전체 적용" 버튼(정리 즉시 실행 → 대기 조각 재시도 표시 초기화 → 매칭 반복, `supabase_mosaic_pieces_retry.sql`)을 쓴다.
- 현재 옵션: `uploadLimitCount`(계정당 업로드 횟수 1~200, 기본 20)·`uploadLimitMinutes`(그 횟수를 세는 구간(분) 1~240, 기본 10) — `mosaic_submissions` 의 insert 트리거 `enforce_mosaic_submission_rate_limit()` 이 `site_settings` 를 직접 읽어 강제하므로 anon 키로 PostgREST 를 직접 두드려도 우회할 수 없다. 작품을 자른 조각 행(`parent_id is not null`)은 세지 않는다. 같은 트리거가 `profiles.upload_blocked` 도 검사한다 (`supabase_admin_moderation.sql`). 미적용이면 20건/10분 고정값으로 동작한다.
- 현재 옵션: `pushEnabled`(웹 푸시 사용, 기본 꺼짐)·`pushPublicKey`(VAPID 공개 키)·`pushEndpoint`(Edge Function 주소) — 셋이 모두 채워져야 알림 패널에 "알림 받기" 버튼이 나오고, 트리거가 발송을 요청한다 (`supabase_push.sql`). 공개 키와 주소를 여기에 두는 덕분에 키를 바꿔도 배포가 필요 없다. **비밀 키는 이 화면에도 저장소에도 넣지 않는다** — `site_settings` 는 anon 도 읽을 수 있다.
- 현재 옵션: `gameEnabled`(조각 찾기 게임 사용, 기본 켜짐)·`gameRankingEnabled`(TOP3·내 순위 표시, 기본 켜짐)·`gameAnonymousPlayEnabled`(비로그인 플레이 허용, 기본 켜짐)·`gameSoundDefault`(효과음 기본값, 기본 켜짐) — `supabase_game.sql`. **`gameEnabled` 는 `start_game` RPC 안에서도 검사한다** — 공개 키로 RPC 를 직접 부를 수 있어 화면을 숨기는 것만으로는 부족하다(이 절의 "화면 가림만으로 끝내지 않는다" 에 해당). 비로그인 기록은 어느 설정에서도 저장되지 않는다 — 세션 자체를 만들지 않는다.
- 현재 옵션: `networkOrbitSpeed`(네트워크 작가 아이콘 회전 속도 배수 1~10, 기본 3) — 1 이면 5분에 한 바퀴(예전 속도), 3 이면 100초에 한 바퀴다. `js/network.js` 가 그래프를 만들 때 한 번 읽어 `ORBIT_BASE_RAD_PER_MS` 에 곱하므로 바꾼 뒤에는 네트워크 페이지를 다시 열어야 적용된다. 노드를 선택한 동안에는 원래대로 회전이 멈춘다 (2026.9.12). **2026.9.14 부터 로그인한 회원은 네트워크 페이지가 "내 네트워크"(자기 노드 선택 상태)로 열리므로 회전은 "전체 보기" 에서만 보인다** — 옵션을 바꾸고 확인할 때 헷갈리지 않게 관리자 도움말에도 적었다. 마지막에 누른 사람의 네트워크는 프로필에서 뒤로 돌아온 로드(`back_forward`)에서만 복원하고, 메뉴·새로고침 진입은 그 저장값을 버린다.
- 현재 옵션: `dbLimitGb`(DB 디스크 한도 GB, 기본 8)·`storageLimitGb`(Storage 한도 GB, 기본 100) — 관리자 "사용량" 타일이 이 값으로 사용률(%)을 계산해 용량 아래에 함께 보여준다(80% 를 넘으면 붉게). 기본값은 Supabase Pro 기준이며, 요금제를 바꾸면 이 두 숫자만 고치면 되고 배포는 필요 없다. 사용량 자체를 바꾸지는 않는다.
- DB 사용량(15절): 옵션을 읽는 페이지 뷰당 요청 1개·약 0.3KB(캠페인 상세 기준 요청 +6%), 옵션을 읽지 않는 페이지는 영향 없음.

---
---

# 아래는 공통 개발 규칙 사본 (`D:\O___GIT\CLAUDE.md`, 2026.9.8 기준)

> 원본이 바뀌면 이 사본도 같이 갱신한다. 위 저장소 고유 규칙과 다른 항목은 저장소 고유 규칙이 우선한다.

# 공통 개발 규칙 (D:\O___GIT 전체)

`D:\O___GIT\` 아래 **모든 저장소에 공통으로 적용**되는, 개발 도구·언어와 무관한 규칙이다.
C++Builder / C# WPF / QMachineStudio 등 **툴체인별 규칙과 프로젝트 고유 규칙은 각 저장소의 `CLAUDE.md`** 에 있다.

- 여기 있는 내용은 각 저장소 `CLAUDE.md` 에도 그대로 남아 있다. 저장소를 단독으로 clone 해도 규칙이 유지되도록 한 **의도된 중복**이다.
- **지침이 서로 다르면 각 저장소의 `CLAUDE.md` 가 우선한다.** (버전 파일 경로, 작성자 표기 형식 등은 프로젝트마다 다르다)

---

## 개발 착수 조건 — 명시적 "개발" 지시가 있을 때만 (필수 · 최우선) (2026.8.3 확정)

> **"보고해 / 검토해 / 제안해 / 분석해 / 알려줘" 처럼 검토·보고를 요청하는 지시에는 코드를 수정하지 않는다.**
> 내용을 **검토만 해서 채팅으로 보고**하고, **개발(코드 수정)은 시작하지 않는다.** 아래 '이슈·수정·개선 요청 표준 처리 순서' 의 자동 진행보다 이 규칙이 우선한다.

- **개발 착수는 "개발해 / 수정해 / 고쳐 / 구현해 / 적용해" 처럼 개발을 명시한 지시가 있을 때만** 한다. 그 지시가 있으면 되묻지 않고 **바로** 표준 처리 순서대로 진행한다.
- 검토·보고 요청에서 개선안이 나오더라도 **제안까지만** 한다. 실제 수정은 사용자가 개발을 지시한 뒤에 시작한다.
- 한 지시에 검토와 개발이 함께 있으면(예: "검토하고 수정해") **개발 지시로 본다.**
- **보고서** — 사용자가 보고서·문서를 만들라고 명시하면 HTML(`.html`) 로 작성한다. (→ '작업 진행 방식' 의 문서 규칙을 따른다) 보고서 작성은 개발 착수가 아니므로 이 규칙에 걸리지 않는다.

---

## 이슈·수정·개선 요청 표준 처리 순서 (필수)
**버그 확인 · 수정 요청 · 개선 검토 등 모든 이슈 처리 요청**은 예외 없이 아래 순서대로 진행한다.
단, **착수 자체는 위 '개발 착수 조건' 을 만족해야 한다** — 검토·보고 요청이면 1~2단계(설명·제안)까지만 하고 멈춘다.
권장안 자동 진행과 자동 커밋(7단계)까지 **사용자의 추가 지시 없이 무조건 수행**하며, 이 절차보다 우선하는 예외나 게이트는 두지 않는다.
**커밋 뒤 _로컬_ `main` 병합과 빌드까지 자동으로 수행한다.** (2026.8.19 확정 — 예전의 '병합도 지시가 있을 때만' 규칙을 대체한다)
**원격 푸시는 여전히 자동으로 하지 않는다 — push 를 콕 집어 지시할 때만 수행한다.** 병합 지시 하나를 push 허가로 확대 해석하지 않는다.
→ 아래 **'main 병합 · 원격(origin) 반영 규칙'** 참조.

> 1단계 전에 **반드시 현재 코드를 먼저 확인**해 이슈가 지금도 실재하는지 검증한다. 재현되지 않거나 해당 코드가 없으면 "현재는 문제 없음" 근거를 제시하고 수정 없이 종료한다.

1. **문제점인 경우** — 원인을 찾아 설명하고 개선 방안을 제시한다. (현재 코드 기준 재현·근거 확인)
2. **추가 개발인 경우** — 기존 기능에 부작용이 생기지 않는 개발 방법을 제시한다.
3. **선택이 필요한 경우** — 제시한 개선 방안 중 **권장 사항**을 골라 곧바로 수정·개발을 진행한다. (별도 지시를 기다리지 않고 권장안으로 진행)
4. **1차 적대적 리뷰** — 수정한 코드를 적대적(adversarial) 관점으로 검토한다. **기존 기능에 부작용이 생겼는지, 개선할 점이 있는지** 철저히 검토해 보고한다.
5. **해결** — 발견된 문제점·개선 항목을 수정한다.
6. **2차 적대적 리뷰** — 다시 적대적 리뷰로 남은 문제점·개선점을 검토 보고한다. 문제점이나 개선할 점이 **남아 있으면 5번으로, 없으면 다음으로** 진행한다.
7. **커밋** — 변경을 커밋한다.
8. **로컬 main 병합 (자동)** — 커밋한 브랜치를 _로컬_ `main` 에 병합한다. 버전 체계가 있는 프로젝트는 이때 버전을 매긴다(→ '버전은 병합 시점에 매긴다').
9. **빌드·검증 (자동)** — `main` 에서 빌드하고, 테스트가 있으면 함께 돌려 결과를 보고한다. 실패하면 고치고 7번부터 다시 한다.
   **push 는 하지 않는다** — 원격 반영은 push 를 명시했을 때만.

---

## 응답 언어 규칙

- 클로드 도구 사용 응답 : **한국어**
- 사용자 응답·설명: **한국어** 기본
- 코드 주석: **한국어**
- 로그/에러 메시지 문자열: **영어** (운영 환경에서 콘솔/파일로 남기 때문)
- 사용자가 별도 언어를 명시하면 그 지시를 우선한다.

### 작업 과정에 표시되는 문구는 전부 한국어 (필수) (2026.7.29 확정)

> 위 규칙을 "채팅 답변만 한국어"로 좁게 해석해 진행 상황·도구 설명·할 일 목록이 영어로 표시되던 문제를 막기 위해 **범위를 못 박는다.**
> **사용자 화면에 보이는 문구는 전부 한국어가 기본**이며, 아래 '영어로 두는 것' 목록만 예외다.

**한국어로 쓴다 — 작업 중 사용자에게 보이는 모든 문구**
- 채팅 답변·설명·보고·요약
- 작업 진행 상황 서술 (지금 무엇을 왜 하는지 알리는 중간 멘트)
- **도구 호출 설명(description)** — Bash 등 도구를 실행할 때 함께 표시되는 한 줄 설명
- **할 일 목록(TODO) 항목**, 작업 제목, 계획(plan) 문구
- 사용자에게 묻는 질문과 선택지·헤더
- 서브에이전트에 주는 지시와 그 결과 보고
- **커밋 메시지**, PR 제목·본문
- 코드 주석, 버전 히스토리 기록

**영어로 둔다 — 예외**
- 프로그램이 콘솔·파일로 남기는 **로그/에러 메시지 문자열** (운영 중 분석용이라 영어 유지)
- 코드 식별자·명령어·파일 경로·git 브랜치 이름(kebab-case) 등 **그대로 써야 동작하는 문자열**
- 인용한 원문 출력(컴파일러 메시지, 외부 도구 출력, 스택 트레이스)은 **번역하지 말고 원문 그대로** 붙이고, 필요하면 한국어 해설을 덧붙인다.

한국어 문장 안에서도 기술 용어·문법 키워드(`FUNCTION`, `switch`, `merge`, `worktree` 등)는 억지로 번역하지 않고 원문을 유지한다.

---

## 작업 진행 방식 (커밋 메시지 · 문서 · 파일 생성)

> 문제 대응·수정·커밋 절차는 위 **"이슈·수정·개선 요청 표준 처리 순서"** 를 따른다. (머지/푸시는 명시적 지시가 있을 때만) 아래는 그 과정에서 함께 적용하는 공통 규칙이다.

- 커밋할 때는 커밋 메시지에 수정 사항을 **최대한 요점만 간결하게** 기록한다.
- **버전은 브랜치가 아니라 `main` 병합 시점에 매긴다 (필수)** (2026.8.18 확정)
  버전은 **브랜치에서 만드는 값이 아니라 `main` 에 합쳐진 순서**다. 세션마다 브랜치에서 각자 번호를 붙이면 반드시 겹치고,
  그 사실을 병합할 때에야 알게 되어 버전 파일·히스토리·커밋 제목을 모두 다시 고쳐야 한다.
  - **브랜치에서는 버전 파일(버전 단일 출처·히스토리 파일)을 수정하지 않는다.** 변경 요약은 **조각 파일**로 남긴다
    (파일 이름을 브랜치마다 다르게 지어 충돌이 물리적으로 나지 않게 한다 — 경로·형식은 각 저장소 `CLAUDE.md` 참고).
  - **브랜치 커밋 제목에는 버전을 넣지 않는다** — `<프로젝트>: <요약>`
  - `main` 에 병합한 뒤, **현재 버전을 읽어서** +1 하고 조각을 히스토리 파일에 합치는 커밋을 만든다.
    **이 커밋의 제목만 버전으로 시작한다** — `v<버전> <프로젝트>: <요약>`
    (예: `v1.0.95 TossTrader: 관심 종목의 해외 주식 이름에 [해외] 표시`)
  - 조각이 여럿이면 **버전은 하나만 올리고** 그 항목에 모두 담는다(그 판에 실제로 들어간 변경 전부).
  - 버전을 맨 앞에 두면 `git log --oneline --first-parent` 에서 세로로 정렬돼 어느 커밋이 어느 판인지 한눈에 들어온다.
    제목 **끝에 `(v1.0.95)` 처럼 다시 붙이지 않는다.** 버전 체계가 없는 프로젝트는 이 규칙을 건너뛴다.
- **문서·리포트류 파일은 사용자가 "문서를 만들어라" 라고 명시적으로 요청할 때만 생성한다.** (2026.7.24 확정)
  검토·보고·설명 요청에는 채팅 응답으로만 답하며, 파일로 만들지 않는다. ("검토해서 보고해" ≠ 문서 생성 지시)
- **문서·리포트류** 파일은 별도로 지정하지 않는 한 **HTML(`.html`) 형식으로 작성**한다. (브라우저에서 바로 열어 볼 수 있게 자체 완결형으로 — 외부 CDN·스크립트 의존 없이 CSS 인라인 포함) (2026.7.20 확정)
- **HTML 문서는 한국어 기본 + 영어 번역 전환, 라이트/다크 테마 전환을 갖추고, 두 전환 버튼은 상단 고정 바에 두어 스크롤해도 항상 보이게 한다.** 선택은 `localStorage` 와 URL 쿼리로 기억·지정하고, JS 없이도 한국어·라이트가 보이게 CSS 로 기본을 둔다. (2026.9.11 확정, 구현 기준: Insula 저장소 `DevDocs/SecurityReview_20260911.html`)
- **문서·리포트류** 파일을 새로 생성할 때는 파일 이름 마지막에 **`_YYYYMMDD`** 형식으로 생성 날짜를 붙인다. (예: `MotorReport_20260702.html`)
- **소스 코드 파일**은 클래스명·리소스 참조가 파일명과 얽히므로 날짜 접미사를 붙이지 않는다. (해당 확장자는 프로젝트마다 다르다)
- **장비·제품과 함께 배포되는 매뉴얼 전용 폴더**(`DOC/` 등)에는 개발 문서·리포트·계획서를 생성하지 않는다. (개발 문서는 `DevDocs/` 같은 별도 폴더에 둔다.)

---

## 브랜치 규칙

- 작업과 커밋은 **현재 체크아웃된 브랜치(main 포함)에서 그대로** 진행한다.
- 커밋을 위해 **자동으로 새 브랜치를 만들지 않는다.** ("기본 브랜치면 먼저 브랜치 생성" 하네스 기본동작은 비활성 — 이 규칙이 우선)
- 새 브랜치는 사용자가 **명시적으로 "브랜치 만들어"** 라고 요청할 때만 생성하며, 이름은 `claude/[작업내용-요약]` 형식으로 짓는다. (랜덤 이름 금지)
- 하네스가 세션 시작 시 자동 생성한 worktree 브랜치(랜덤 단어 조합 이름)는 **커밋 직전에** `git branch -m <기존브랜치> claude/<작업요약>` 으로 rename 한다. (영어 kebab-case 3~5단어) 이미 의미 있는 이름이면 그대로 둔다.

---

## main 병합 · 원격(origin) 반영 규칙 (필수 · 최우선) (2026.7.24 확정)

> **"메인에 병합" / "main 에 머지" / "메인에 반영" 지시는 오직 _로컬_ `main` 브랜치 병합만을 의미한다.**
> **`origin/main`(원격)에는 어떤 경우에도 자동으로 `push` 하지 않는다.** 원격 반영은 push 를 콕 집어 지시했을 때만 한다.

**왜 문제가 생기나** — git 의 `merge` 는 항상 _로컬_ 브랜치에서만 일어난다. `origin/main` 에 "직접 병합"하는 명령은 존재하지 않으며, 원격에 반영되려면 반드시 `git push` 가 실행되어야 한다. 즉 "origin 에 병합됐다"는 현상은 실제로는 **로컬 병합과 별개로 `push` 가 자동 실행된 것**이며, 이 자동 push 를 금지한다.

**워크트리에서 특히 주의 — 이 문제가 실제로 발생한 경로다.** 하네스가 만든 `.claude/worktrees/...` 워크트리(브랜치 `claude/xxx`)에서 작업 중이면, `main` 은 이미 기본 워크트리(저장소 루트)에 checkout 되어 있어 워크트리 안에서 `git checkout main` / `git switch main` 이 **`fatal: 'main' is already checked out at ...`** 로 실패한다. 이때 **절대 아래 명령으로 우회하지 않는다:**
> ❌ `git push origin HEAD:main`  ❌ `git push origin claude/xxx:main`  ❌ `git push origin main`
> — 이들은 로컬 main 을 건너뛰고 **origin/main 을 직접 갱신**한다. 바로 이것이 "로컬이 아닌 origin 에 병합되는" 문제의 원인이다.

**로컬 main 에 병합하는 올바른 방법** — `main` 이 checkout 되어 있는 기본 워크트리(저장소 루트)에서 병합한다. push 는 하지 않는다.
```bash
git worktree list                          # [main] 이 붙은 경로(저장소 루트) 확인
git -C "<[main] 경로>" merge claude/xxx     # 그 경로에서 로컬 병합만 수행
```

**규칙 요약**
- **커밋했으면 로컬 `main` 병합과 빌드까지 자동으로 한다** (2026.8.19 확정). 따로 "메인 머지" 라고 말하지 않아도 된다.
- "메인에 병합/머지/반영" → **로컬 `main` 병합까지만.** `git push` 는 하지 않는다.
- **병합 지시 ≠ push 지시.** 둘은 서로 다른 별개의 명시적 지시이며, 병합 지시 하나를 push 허가로 확대 해석하지 않는다.
- 원격 반영은 **"푸시해 / origin 에 올려 / 원격에 push / `git push` 해줘"** 처럼 push 를 명시했을 때만 수행한다.
- 현재 브랜치가 `main` 이고 `origin/main` 을 추적 중이어도 로컬 커밋·병합 뒤 **자동 push 금지.** 로컬이 `ahead` 로 남는 것이 정상이다.
- 로컬 main 병합이 불가능한 상황(충돌, 워크트리 제약 등)이면 **origin 으로 우회하지 말고 멈춰서 사용자에게 보고**한다.

---

## 수정 사항 기록 (버전 히스토리)

> 기록 파일의 **이름·경로와 작성자 표기 형식은 프로젝트마다 다르다.** 각 저장소 `CLAUDE.md` 를 확인하고 **기존 파일에 쓰인 형식을 그대로** 따른다.

- 코드를 수정한 후에는 그 프로젝트가 사용하는 **버전 정보 / 히스토리 파일**에 변경 내용을 기록한다.
  단, **브랜치에서 작업 중이면 히스토리 파일을 직접 고치지 않고 조각 파일에 쓴다** — 위 '버전은 병합 시점에 매긴다' 참고.
  조각의 내용 형식(사용자 관점 · 한 줄 · 접두어)은 히스토리 파일에 쓸 때와 똑같다.
- **이슈별로 한 줄**, 한 줄에 **100글자 내외**로 간단하게 기록한다.
- 개발자 상세가 아니라 **사용자 관점**으로 쓴다 — 어떤 기능·이슈가 어떻게 바뀌었는지.
- 접두어: 버그 수정 `fix:`, 신규 기능 `feat:`, 정리·리팩터링 `chore:`
- 같은 날짜의 항목은 **최근 작업이 위쪽**에 오도록 기록한다.

---

## 공통 개발 원칙

- **기존 코드 스타일과 구조를 존중하며 최소 변경 원칙**을 따른다. 리팩터링은 요청받았을 때만 수행한다.
- **새 기능을 임의로 추가하지 않는다.** 요청 범위 밖의 리팩터링·재구조화·추상화는 사용자에게 먼저 확인한다.
- 동작 안정성을 최우선으로 하고, 기능 추가보다 **기존 동작 보존**이 더 중요할 수 있음을 항상 고려한다.
- 운영 중 장애 분석이 가능한 구조를 선호한다.
- 과도한 최신 문법·불필요한 추상화보다 **읽기 쉽고 유지보수하기 쉬운 코드**를 우선한다.
- 읽기 쉬운 구조와 명확한 함수 분리를 우선한다.
- 코드 주석은 한국어로 작성하고, "무엇을" 보다 **"왜"** 를 중심으로 쓴다.
- 추상적인 설명만 하지 말고 **바로 적용 가능한 예시**를 함께 제공한다.

---

## 최종 원칙

Claude 는 항상 아래를 우선 고려한다.

- 안정성
- 기존 동작 보존
- 운영 중 분석 가능성
- 유지보수성
- 실무 적용 가능성
