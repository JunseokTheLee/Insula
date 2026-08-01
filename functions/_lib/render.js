// Shared HTMLRewriter-based "real prerendering" for the project/artwork/
// artist detail pages: fetches the static template asset unchanged, then
// rewrites just its <head> tags (title/description/canonical/hreflang/OG/
// Twitter/JSON-LD) using the real entity's data before returning it to the
// requester — the same HTML goes to bots and browsers alike (no cloaking),
// it's just filled in with the specific project/artwork/artist this URL
// names instead of the template's generic placeholder copy. The client JS
// that hydrates afterward (project.js etc.) fills in the same tags again
// once it loads, as defense-in-depth for the rare case this Function is
// bypassed.

// Named `content`, not `text` — HTMLRewriter's ElementContentHandlers
// interface treats a `text` property on the handler object as a reserved
// text-chunk-handler slot (distinct from `element`) and throws if it's set
// to anything other than a function, which a plain string very much isn't.
class SetContent {
  constructor(content) { this.content = content; }
  element(el) { el.setInnerContent(this.content); }
}
class SetAttr {
  constructor(attr, value) { this.attr = attr; this.value = value; }
  element(el) { if (this.value) el.setAttribute(this.attr, this.value); }
}
class AppendHtml {
  constructor(html) { this.html = html; }
  element(el) { el.append(this.html, { html: true }); }
}

// `page` = { title, description, canonical, hreflangEn, hreflangKo, image, locale, jsonld: [...] }
export function renderEntityPage(assetResponse, page) {
  const jsonldHtml = (page.jsonld || [])
    .map(obj => `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, '\\u003c')}</script>`)
    .join('\n');

  let rewriter = new HTMLRewriter()
    .on('title', new SetContent(page.title))
    .on('meta[name="description"]', new SetAttr('content', page.description))
    .on('link[rel="canonical"]', new SetAttr('href', page.canonical))
    .on('meta[property="og:title"]', new SetAttr('content', page.title))
    .on('meta[property="og:description"]', new SetAttr('content', page.description))
    .on('meta[property="og:url"]', new SetAttr('content', page.canonical))
    .on('meta[name="twitter:title"]', new SetAttr('content', page.title))
    .on('meta[name="twitter:description"]', new SetAttr('content', page.description));

  if (page.hreflangEn) rewriter = rewriter.on('link[rel="alternate"][hreflang="en"]', new SetAttr('href', page.hreflangEn));
  if (page.hreflangKo) rewriter = rewriter.on('link[rel="alternate"][hreflang="ko"]', new SetAttr('href', page.hreflangKo));
  if (page.image) {
    rewriter = rewriter
      .on('meta[property="og:image"]', new SetAttr('content', page.image))
      .on('meta[name="twitter:image"]', new SetAttr('content', page.image));
  }
  if (jsonldHtml) rewriter = rewriter.on('head', new AppendHtml(jsonldHtml));

  return rewriter.transform(assetResponse);
}

// The real HTTP 404 status is what actually keeps this out of the index —
// that's set on the Response itself, not via a meta tag — this just also
// swaps the visible title so a directly-viewed 404 doesn't show stale
// template copy ("Weavo — Project") instead of an honest "not found".
export function notFoundResponse(assetResponse, notFoundTitle) {
  return new HTMLRewriter()
    .on('title', new SetContent(notFoundTitle))
    .transform(new Response(assetResponse.body, { status: 404, headers: assetResponse.headers }));
}
