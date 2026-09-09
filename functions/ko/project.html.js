// Legacy address: /ko/project.html?id=X — see functions/en/project.html.js
// for the full rationale, same behavior for the Korean directory.
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (id) return Response.redirect(`${url.origin}/ko/campaigns/${encodeURIComponent(id)}`, 301);
  return Response.redirect(`${url.origin}/ko/campaigns`, 301); // template renamed to campaign.html — bare hits go to the list
}
