// Root "/" language chooser — a real server-side redirect (302, since the
// choice isn't permanent/canonical the way a moved page would be) instead of
// the client-side-only `location.replace()` index.html previously relied on
// solely, so a crawler or JS-disabled visitor gets sent to /en/ or /ko/
// immediately rather than seeing an empty redirect shell.
//
// Preference order: an explicit weavoLang cookie (set by wireLangToggle() in
// common.js when someone manually switches language) beats Accept-Language,
// which beats the 'en' default. Query string is forwarded explicitly since
// the server sees it; the URL fragment (an OAuth-callback token, per the
// comment on the static index.html fallback) is never sent to the server at
// all, but browsers automatically re-attach an original request's fragment
// onto a redirect target that doesn't specify its own — so it survives this
// hop without any special handling here.
function detectLang(request) {
  const cookieHeader = request.headers.get('Cookie') || '';
  const cookieMatch = cookieHeader.match(/(?:^|;\s*)weavoLang=(en|ko)/);
  if (cookieMatch) return cookieMatch[1];
  const acceptLanguage = request.headers.get('Accept-Language') || '';
  if (/^ko\b|,\s*ko\b/i.test(acceptLanguage)) return 'ko';
  return 'en';
}

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const lang = detectLang(request);
  const dest = new URL(`/${lang}/`, url);
  dest.search = url.search;
  return Response.redirect(dest.toString(), 302);
}
