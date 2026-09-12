// Web push notifications — the "turn on notifications" switch in the
// notification panel, the service-worker registration behind it, and the
// bookkeeping that keeps push_subscriptions in step with the browser.
//
// Loaded after js/notifications.js (it hangs its switch on that panel) and
// needs sb/me/authReady from auth.js, getSiteSettings/toast from common.js
// and tr from the i18n file.
//
// Two registrations live here, and they never both apply on one device:
//
//   • BROWSER — a Web Push subscription (service worker + VAPID). Needs
//     serviceWorker/PushManager, so it is skipped in the app's WebView.
//   • APP — the FCM token the Weavo mobile app (Flutter, art.weavo.app)
//     hands over through window.WeavoAppBridge. A WebView has no Web Push
//     API at all, which is why the app needs its own path.
//
// Nothing here can send a notification. Rows land in `notifications` from
// the triggers in supabase_notifications.sql, an AFTER INSERT trigger asks
// the Edge Function to deliver them (supabase_push.sql +
// supabase_push_tokens.sql → supabase/functions/push/index.ts), and sw.js
// (browser) or the app itself shows what arrives. This file only ever
// registers a device and stores it.
"use strict";

(function () {
  // Push needs all three; a browser missing any of them (iOS Safari outside
  // an installed web app, older WebViews) simply never sees the switch.
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

  let swReady = null;       // Promise<ServiceWorkerRegistration>
  let publicKey = '';       // VAPID public key, from the site options
  let switchEl = null;

  // ---------- helpers ----------
  // The applicationServerKey has to be raw bytes, and the key is stored
  // (and generated) as URL-safe base64.
  function keyBytes(base64Url) {
    const padded = (base64Url + '='.repeat((4 - (base64Url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(padded);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  function b64(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }

  function registerWorker() {
    if (!swReady) swReady = navigator.serviceWorker.register('/sw.js', { scope: '/' });
    return swReady;
  }

  // ---------- storing the subscription ----------
  async function storeSubscription(sub) {
    if (!me.id || !sub) return false;
    const json = sub.toJSON ? sub.toJSON() : {};
    const keys = json.keys || {};
    if (!json.endpoint || !keys.p256dh || !keys.auth) return false;
    // Through the RPC, not a plain upsert: an endpoint belongs to the
    // BROWSER, so on a shared device the row may still be the previous
    // account's — which RLS would (rightly) refuse to let this one update.
    // save_push_subscription hands the endpoint over instead.
    const { error } = await sb.rpc('save_push_subscription', {
      p_endpoint: json.endpoint,
      p_p256dh: keys.p256dh,
      p_auth: keys.auth,
      // The message text is built per device from this — there is no
      // per-account language setting to read on the server.
      p_lang: CURRENT_LANG === 'en' ? 'en' : 'ko',
      p_user_agent: (navigator.userAgent || '').slice(0, 300),
    });
    if (error) { console.error('store push subscription error:', error); return false; }
    return true;
  }

  async function forgetSubscription(endpoint) {
    if (!endpoint) return;
    const { error } = await sb.from('push_subscriptions').delete().eq('endpoint', endpoint);
    if (error) console.error('remove push subscription error:', error);
  }

  // ---------- the switch ----------
  async function currentSubscription() {
    const reg = await registerWorker();
    return reg.pushManager.getSubscription();
  }

  async function turnOn() {
    if (!publicKey) { toast(tr('pushNotConfigured')); return false; }
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      toast(permission === 'denied' ? tr('pushBlocked') : tr('pushNotAllowed'));
      return false;
    }
    const reg = await registerWorker();
    let sub = await reg.pushManager.getSubscription();
    // A subscription made with a different (rotated) key can't be reused —
    // the push service would reject the sender's signature.
    if (sub) {
      const existing = sub.options && sub.options.applicationServerKey;
      if (existing && b64(existing) !== b64(keyBytes(publicKey))) { await sub.unsubscribe(); sub = null; }
    }
    if (!sub) {
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
    }
    const ok = await storeSubscription(sub);
    toast(ok ? tr('pushOn') : tr('pushCouldNotSave'));
    return ok;
  }

  async function turnOff() {
    const sub = await currentSubscription();
    if (sub) { await forgetSubscription(sub.endpoint); await sub.unsubscribe(); }
    toast(tr('pushOff'));
  }

  function renderSwitch(on, blocked) {
    if (!switchEl) return;
    switchEl.textContent = blocked ? tr('pushBlockedShort') : (on ? tr('pushTurnOff') : tr('pushTurnOn'));
    switchEl.classList.toggle('on', !!on && !blocked);
    switchEl.disabled = !!blocked;
    switchEl.title = blocked ? tr('pushBlocked') : '';
  }

  async function refreshSwitch() {
    if (!switchEl) return;
    const blocked = Notification.permission === 'denied';
    let on = false;
    if (!blocked && Notification.permission === 'granted') {
      try { on = !!(await currentSubscription()); } catch (e) { console.error('push subscription lookup error:', e); }
    }
    renderSwitch(on, blocked);
  }

  function mountSwitch() {
    const head = document.querySelector('#notifPanel .notif-panel-head');
    if (!head || switchEl) return;
    switchEl = document.createElement('button');
    switchEl.type = 'button';
    switchEl.id = 'pushToggle';
    switchEl.className = 'notif-mark-all push-toggle';
    switchEl.onclick = async () => {
      switchEl.disabled = true;
      try {
        const sub = await currentSubscription();
        if (sub) await turnOff(); else await turnOn();
      } catch (e) {
        console.error('push toggle error:', e);
        toast(tr('pushFailed'));
      }
      switchEl.disabled = false;
      refreshSwitch();
    };
    head.insertBefore(switchEl, head.querySelector('#notifMarkAll'));
    refreshSwitch();
  }

  // ---------- boot ----------
  // Keeps a live subscription's row fresh on every page load: the browser
  // may have rotated the endpoint (pushsubscriptionchange in sw.js
  // re-subscribes but cannot reach the database), and a user signing in on
  // a device that already granted permission gets their row written here.
  // Once per tab session per endpoint, not once per page load — every page
  // on the site runs this file, and re-writing an unchanged row on each
  // navigation would be a request per page view for no benefit.
  const SYNCED_KEY = 'weavo.pushSynced';
  async function syncOnLoad() {
    if (!me.id || Notification.permission !== 'granted') return;
    try {
      const sub = await currentSubscription();
      if (!sub) return;
      const mark = `${me.id}|${sub.endpoint}`;
      let seen = null;
      try { seen = sessionStorage.getItem(SYNCED_KEY); } catch (e) { /* private mode — just sync */ }
      if (seen === mark) return;
      if (await storeSubscription(sub)) {
        try { sessionStorage.setItem(SYNCED_KEY, mark); } catch (e) { /* no cache, syncs again next page */ }
      }
    } catch (e) { console.error('push sync error:', e); }
  }

  // ---------- the app's FCM token ----------
  // Only exists inside the Weavo app's WebView; a browser has no bridge and
  // skips all of this. The app answers with
  //   { enabled, permission, token }
  // and `enabled: false` means the user turned notifications off there — not
  // an error, just nothing to do. A token is issued even while permission is
  // still 'notDetermined', so it is worth storing whenever one is present:
  // the row is ready the moment they say yes.
  function appBridge() {
    return (typeof window !== 'undefined' && window.WeavoAppBridge) || null;
  }
  async function syncAppPushToken() {
    const bridge = appBridge();
    if (!bridge || !me.id) return;
    let info = null;
    try { info = await bridge.call('GET_PUSH_TOKEN'); }
    catch (e) { console.error('app push token error:', e); return; }
    if (!info || !info.enabled || !info.token) return;
    const { error } = await sb.rpc('save_push_token', {
      p_token: info.token,
      p_platform: String(bridge.platform || '').slice(0, 20) || null,
      p_lang: CURRENT_LANG === 'en' ? 'en' : 'ko',
    });
    if (error) console.error('save_push_token error:', error);
  }
  // Called from auth.js right before the session goes away, so a shared
  // phone stops receiving the previous account's notifications. The row is
  // still this user's at that point, so the plain row-owner delete policy
  // covers it.
  async function forgetAppPushToken() {
    const bridge = appBridge();
    if (!bridge || !me.id) return;
    try {
      const info = await bridge.call('GET_PUSH_TOKEN');
      if (!info || !info.token) return;
      const { error } = await sb.from('push_tokens').delete().eq('token', info.token);
      if (error) console.error('remove push token error:', error);
    } catch (e) { console.error('forget app push token error:', e); }
  }
  window.forgetAppPushToken = forgetAppPushToken;

  async function start() {
    await authReady;

    // The app path first, and outside the Web Push guards below: it needs
    // neither a service worker nor a VAPID key, and inside the WebView the
    // browser half never runs at all.
    const syncApp = () => { syncAppPushToken().catch(e => console.error('app push sync error:', e)); };
    syncApp();
    document.addEventListener('weavo:authchange', syncApp);
    // The app re-issues tokens on its own schedule and tells the page when
    // it does.
    window.addEventListener('weavoapp', e => {
      if (e && e.detail && e.detail.type === 'PUSH_TOKEN') syncApp();
    });

    if (!supported) return;
    const settings = await getSiteSettings();
    if (!settings.pushEnabled || !settings.pushPublicKey) return; // feature off, or no key yet
    publicKey = String(settings.pushPublicKey).trim();

    const apply = () => {
      if (!me.id) { if (switchEl) { switchEl.remove(); switchEl = null; } return; }
      mountSwitch();
      syncOnLoad();
    };
    apply();
    document.addEventListener('weavo:authchange', apply);
  }

  start().catch(e => console.error('push init error:', e));
})();
