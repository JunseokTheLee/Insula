// Legacy clean address: /ko/project?id=X. Until the 2026-09-09 rename the
// static template project.html was served here (Cloudflare strips .html), so
// links copied from the address bar carried this form. The template is now
// campaign.html, so without this Function the address would 404 — send it on
// to the canonical /ko/campaigns/{id} route instead (same as project.html.js
// does for the .html spelling). Bare requests go to the campaign list.
export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (id) return Response.redirect(`${url.origin}/ko/campaigns/${encodeURIComponent(id)}`, 301);
  return Response.redirect(`${url.origin}/ko/campaigns`, 301);
}
