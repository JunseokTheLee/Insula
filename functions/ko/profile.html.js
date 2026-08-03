// Legacy address: /ko/profile.html?user=X — see functions/en/profile.html.js
// for the rationale.
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const user = url.searchParams.get('user');
  if (user) return Response.redirect(`${url.origin}/ko/artists/${encodeURIComponent(user)}`, 301);
  return env.ASSETS.fetch(request);
}
