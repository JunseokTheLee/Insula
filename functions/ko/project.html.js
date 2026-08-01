// Legacy address: /ko/project.html?id=X — see functions/en/project.html.js
// for the full rationale, same behavior for the Korean directory.
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (id) return Response.redirect(`https://weavo.art/ko/projects/${encodeURIComponent(id)}`, 301);
  return env.ASSETS.fetch(request);
}
