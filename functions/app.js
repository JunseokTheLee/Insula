// /app — the one address behind the "Get the Weavo app" QR code and the
// footer button (2026-10-01).
//
//   * App installed: the phone never gets here. iPhone universal links
//     (/.well-known/apple-app-site-association) and Android app links
//     (/.well-known/assetlinks.json) hand weavo.art/app straight to the app.
//   * Inside the app (it was opened on this address and loaded it in its
//     WebView): go to the home page — the app's bridge is the tell.
//   * iPhone / iPad: the App Store. Android: Google Play.
//   * A computer, or a store not set up yet: a small page with the QR code
//     and whichever store buttons exist.
//
// Why a page and not a plain 302: the server cannot tell the app's WebView
// from a phone browser (the app is recognised only by window.WeavoAppBridge,
// which exists in the page), and redirecting the app to its own store page
// would be the one wrong answer. The script waits a moment for the bridge.
// Store ids live in the admin page's site options (functions/_lib/app-links.js).
import { loadAppSettings } from './_lib/app-links.js';

function detectLang(request) {
  const cookie = request.headers.get('Cookie') || '';
  const m = cookie.match(/(?:^|;\s*)weavoLang=(en|ko)/);
  if (m) return m[1];
  return /^ko\b|,\s*ko\b/i.test(request.headers.get('Accept-Language') || '') ? 'ko' : 'en';
}

const TEXT = {
  ko: {
    title: 'Weavo 앱', heading: 'Weavo 앱으로 열기',
    hint: '휴대폰 카메라로 QR 코드를 찍어 주세요. 앱이 있으면 바로 열리고, 없으면 스토어로 이동합니다.',
    soon: '앱 스토어 준비 중입니다. 지금은 웹사이트에서 이용해 주세요.',
    moving: '스토어로 이동하는 중…', home: 'Weavo 웹사이트로 가기',
  },
  en: {
    title: 'Weavo app', heading: 'Open in the Weavo app',
    hint: 'Scan the QR code with your phone camera. It opens the app if you have it, or the app store if you do not.',
    soon: 'The app is not in the stores yet. For now, use the website.',
    moving: 'Opening the store…', home: 'Go to the Weavo website',
  },
};

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export async function onRequestGet({ request }) {
  const lang = detectLang(request);
  const t = TEXT[lang];
  let app = { enabled: false, ios: null, android: null };
  try { app = await loadAppSettings(); } catch (e) { /* settings unreadable: show the plain page */ }
  const ios = app.enabled ? app.ios : null;
  const android = app.enabled ? app.android : null;
  const home = `/${lang}/`;
  const stores = [ios && `<a class="store" href="${esc(ios)}">App Store</a>`, android && `<a class="store" href="${esc(android)}">Google Play</a>`]
    .filter(Boolean).join('');

  const html = `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<meta name="robots" content="noindex">
<title>${esc(t.title)}</title>
<link rel="icon" href="/logo-96.png">
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f6f7f5;color:#1d231f;
    font-family:'Pretendard',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;}
  main{width:min(400px,calc(100vw - 32px));background:#fff;border-radius:20px;padding:32px 24px 26px;text-align:center;box-shadow:0 10px 40px rgba(0,0,0,.08);}
  .logo{width:48px;height:48px;border-radius:50%;}
  h1{font-size:21px;margin:14px 0 18px;}
  .qr{display:block;width:200px;height:200px;margin:0 auto;image-rendering:pixelated;}
  p{font-size:13px;line-height:1.6;color:#6b736d;margin:16px 0 0;word-break:keep-all;}
  .stores{display:flex;justify-content:center;gap:8px;margin-top:16px;flex-wrap:wrap;}
  .store,.home{font-size:13px;font-weight:600;text-decoration:none;padding:9px 16px;border-radius:999px;border:1px solid #cfd5d1;color:#1d231f;}
  .home{display:inline-block;margin-top:18px;border:none;color:#2f7d4f;}
  .moving .qr,.moving .hint{display:none;}
</style>
</head>
<body>
<main id="m">
  <img class="logo" src="/logo-96.png" alt="">
  <h1>${esc(t.heading)}</h1>
  <img class="qr" src="/app-qr.svg" width="200" height="200" alt="QR: weavo.art/app">
  <p class="hint">${esc(stores ? t.hint : t.soon)}</p>
  <p class="status" id="st" hidden>${esc(t.moving)}</p>
  ${stores ? `<div class="stores">${stores}</div>` : ''}
  <a class="home" href="${esc(home)}">${esc(t.home)}</a>
</main>
<script>
(function () {
  var IOS = ${JSON.stringify(ios)}, ANDROID = ${JSON.stringify(android)}, HOME = ${JSON.stringify(home)};
  function go() {
    if (window.WeavoAppBridge) { location.replace(HOME); return; }
    var ua = navigator.userAgent || '';
    var apple = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    var target = apple ? IOS : (/Android/.test(ua) ? ANDROID : null);
    if (!target) return;
    document.getElementById('m').className = 'moving';
    document.getElementById('st').hidden = false;
    location.replace(target);
  }
  setTimeout(go, 350);
})();
</script>
</body>
</html>`;
  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' },
  });
}
