// Legacy address: /en/profile.html?user=X — see functions/en/project.html.js
// for the rationale. Redirects straight to the id form (/en/artists/{id});
// the artists/[handle].js Function then further canonicalizes that to the
// username URL if one exists, same as it does for any other id-based link.
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const user = url.searchParams.get('user');
  if (user) return Response.redirect(`https://weavo.art/en/artists/${encodeURIComponent(user)}`, 301);
  return env.ASSETS.fetch(request);
}
