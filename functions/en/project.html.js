// Legacy address: /en/project.html?id=X (the pre-rewrite URL form). Anyone
// still hitting it — an old bookmark or shared link — gets a real, permanent
// redirect to the canonical /en/campaigns/{id} route rather than a client-side
// JS bounce, so search engines consolidate onto the new URL. Bare requests
// with no id (nothing to redirect to) just fall through to the plain
// template, same as before this Function existed.
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (id) return Response.redirect(`${url.origin}/en/campaigns/${encodeURIComponent(id)}`, 301);
  return Response.redirect(`${url.origin}/en/campaigns`, 301); // template renamed to campaign.html — bare hits go to the list
}
