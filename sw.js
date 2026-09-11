// Weavo service worker — push notifications ONLY.
//
// It deliberately has NO fetch handler and caches nothing. /js and /css are
// served with a one-year immutable cache and busted by the ?v= query in
// every page's script/link tags (CLAUDE.md §12); a service-worker cache on
// top of that is a second, invisible cache layer with its own staleness
// rules — exactly the class of bug that already bit this site once (an edge
// node serving an old file under a new ?v=). The only job here is to be
// alive when a push arrives.
//
// Registered by js/push.js from the site root so its scope is the whole
// site. Served with Cache-Control: no-cache (_headers) so a new version is
// picked up on the next visit rather than up to 24h later.

const NOTIFICATION_ICON = '/logo-96.png';

// The payload the Edge Function sends (supabase/functions/push/index.ts):
//   { title, body, url, tag }
// Anything missing falls back to something sensible — a push that fails to
// show a notification at all costs the site its push permission in Chrome.
self.addEventListener('push', event => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; }
  catch (e) { payload = { body: event.data ? event.data.text() : '' }; }

  const title = payload.title || 'Weavo';
  const options = {
    body: payload.body || '',
    icon: NOTIFICATION_ICON,
    badge: NOTIFICATION_ICON,
    // One notification per subject: a second like on the same artwork
    // replaces the first rather than stacking.
    tag: payload.tag || 'weavo',
    renotify: !!payload.tag,
    data: { url: payload.url || '/' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Focus an open Weavo tab/app window and take it to the target, or open a
// new one. clients.openWindow() is the fallback — some platforms refuse
// navigate() on a client that isn't controlled by this worker.
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin);
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of all) {
      if (new URL(client.url).origin !== target.origin) continue;
      await client.focus();
      if ('navigate' in client) { try { await client.navigate(target.href); } catch (e) { /* focus alone is fine */ } }
      return;
    }
    await self.clients.openWindow(target.href);
  })());
});

// Browsers rotate push endpoints on their own; without this the old
// subscription row in push_subscriptions goes silently dead. The worker
// can't reach Supabase's client library, so it just re-subscribes with the
// same application key and lets the next page load record the new endpoint
// (js/push.js syncs on every load).
self.addEventListener('pushsubscriptionchange', event => {
  const old = event.oldSubscription;
  const key = old && old.options && old.options.applicationServerKey;
  if (!key) return;
  event.waitUntil(self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }));
});

// A newly deployed worker takes over immediately instead of waiting for
// every tab to close — there is no cached content for the old one to be
// consistent with.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
