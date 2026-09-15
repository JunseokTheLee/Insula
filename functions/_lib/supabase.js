// Minimal PostgREST client for use inside Cloudflare Pages Functions —
// plain fetch() against Supabase's REST endpoint rather than importing
// @supabase/supabase-js, since this project has no build step / node_modules
// for the Functions bundler to resolve that package from. Uses the same
// publishable anon key the browser client already uses (js/supabase-client.js);
// it's designed to be public and is subject to the same RLS policies either way.
const SUPABASE_URL = 'https://kzvheplmtzjmzcxjkxub.supabase.co';
const SUPABASE_KEY = 'sb_publishable_ohcQ5SUnO_lH_HYGgOtxnQ_umqwx027';

async function pgFetch(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  if (!res.ok) return null;
  return res.json();
}

export async function pgFetchOne(path) {
  const rows = await pgFetch(path);
  return (rows && rows[0]) || null;
}

export async function pgFetchMany(path) {
  return (await pgFetch(path)) || [];
}

// Whether `url` is a file uploaded to this site's Storage, as opposed to a
// picture hosted elsewhere (a Google/Apple sign-in avatar). Share images
// care: sign-in avatars are tiny — Google hands out 96x96 — below what
// Facebook (200x200) and X (300x157) will show in a link preview.
export function isSiteUpload(url) {
  return typeof url === 'string' && url.startsWith(`${SUPABASE_URL}/storage/v1/object/public/`);
}
