// The mobile-app values from the admin site options (site_settings row,
// keys app* — defaults in js/common.js SITE_SETTING_DEFAULTS), validated,
// for functions/app.js and functions/.well-known/apple-app-site-association.js.
// common.js appStoreLinks() builds the same store URLs in the browser —
// keep the two in step.
import { pgFetchOne } from './supabase.js';

export async function loadAppSettings() {
  const row = await pgFetchOne('site_settings?id=eq.true&select=settings');
  const s = (row && row.settings) || {};
  const iosId = String(s.appIosAppId || '').trim();
  const teamId = String(s.appIosTeamId || '').trim().toUpperCase();
  const bundleId = String(s.appIosBundleId || '').trim();
  const pkg = String(s.appAndroidPackage || 'art.weavo.app').trim();
  return {
    enabled: s.appDownloadEnabled === true,
    ios: /^\d{5,15}$/.test(iosId) ? `https://apps.apple.com/app/id${iosId}` : null,
    android: s.appAndroidOnPlay === true && /^[a-zA-Z][\w]*(\.[a-zA-Z][\w]*)+$/.test(pkg)
      ? `https://play.google.com/store/apps/details?id=${encodeURIComponent(pkg)}` : null,
    // "TEAMID.bundle.id" — what an iPhone checks before it lets weavo.art
    // links open the app (universal links). Null until both parts are set.
    appleAppId: /^[A-Z0-9]{10}$/.test(teamId) && /^[A-Za-z0-9][A-Za-z0-9.-]*$/.test(bundleId)
      ? `${teamId}.${bundleId}` : null,
  };
}
