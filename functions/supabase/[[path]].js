// /supabase/* lives in the repository (which is also the deploy root) for
// developers only — never a page of the site. Answer 404 so nothing under
// it can be fetched from the web (a Function route wins over the static
// file that would otherwise be served). robots.txt disallows it as well.
export const onRequest = () =>
  new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } });
