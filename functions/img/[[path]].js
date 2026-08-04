// Proxies Supabase Storage public objects (artwork images, thumbnails,
// avatars) through this same origin so Cloudflare's edge cache absorbs
// repeat requests — only the first request per edge location per object
// actually reaches Supabase, instead of every visitor's browser hitting
// Supabase's billed Storage/CDN egress directly. js/common.js's cdnUrl()
// rewrites Supabase storage URLs to /img/<bucket>/<path...> to route here;
// params.path is that <bucket>/<path...> segment array.
const SUPABASE_URL = 'https://kzvheplmtzjmzcxjkxub.supabase.co';
const CACHE_CONTROL = 'public, max-age=31536000, immutable';

export async function onRequestGet({ request, params }) {
  const path = Array.isArray(params.path) ? params.path.join('/') : params.path;
  if (!path) return new Response('Not found', { status: 404 });

  const cache = caches.default;
  const cacheKey = new Request(new URL(request.url).toString(), request);

  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const upstream = await fetch(`${SUPABASE_URL}/storage/v1/object/public/${path}`);
  if (!upstream.ok) return new Response('Not found', { status: upstream.status });

  const response = new Response(upstream.body, upstream);
  response.headers.set('Cache-Control', CACHE_CONTROL);

  await cache.put(cacheKey, response.clone());
  return response;
}
