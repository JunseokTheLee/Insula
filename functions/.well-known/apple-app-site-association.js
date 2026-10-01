// /.well-known/apple-app-site-association — what an iPhone fetches (through
// Apple's CDN) to decide whether weavo.art links may open the Weavo app
// instead of Safari: iOS "universal links" (2026-10-01).
//
// Only /app is claimed — the QR code and the footer button. Claiming every
// path would make every weavo.art link anywhere jump into the app, which is
// a bigger decision than this feature needs. The Team ID and bundle ID come
// from the admin page's site options (functions/_lib/app-links.js); until
// both are set this answers 404, which simply means "no app".
//
// The app needs the matching entitlement too: Associated Domains
// "applinks:weavo.art" (app side, not this repository).
import { loadAppSettings } from '../_lib/app-links.js';

export async function onRequestGet() {
  let app = null;
  try { app = await loadAppSettings(); } catch (e) { app = null; }
  if (!app || !app.appleAppId) return new Response('Not found', { status: 404 });
  const body = {
    applinks: {
      // iOS 13+ reads "details[].appIDs/components"; older iOS reads
      // "apps"/"appID"/"paths". Both say the same thing.
      apps: [],
      details: [{
        appIDs: [app.appleAppId],
        components: [{ '/': '/app', comment: 'Get the Weavo app (QR, footer)' }, { '/': '/app/*' }],
        appID: app.appleAppId,
        paths: ['/app', '/app/*'],
      }],
    },
  };
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' },
  });
}
