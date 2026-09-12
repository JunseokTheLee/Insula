// Supabase Edge Function "push" — delivers one notification row to every
// device its recipient has registered: browsers through Web Push, and the
// Weavo mobile app (Flutter WebView, art.weavo.app) through FCM HTTP v1.
//
// Deploy:  supabase functions deploy push --no-verify-jwt
// Secrets: supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:...
//          supabase secrets set FCM_SERVICE_ACCOUNT='<the whole service-account JSON>'
//          (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by the platform)
//
// Either half can be missing: without the VAPID keys the browsers are
// skipped, without FCM_SERVICE_ACCOUNT the app is skipped, and the other
// half still goes out. Nothing here throws because a secret is unset.
//
// Called by the AFTER INSERT trigger on public.notifications
// (supabase/supabase_push.sql) through pg_net, with body {"id": <bigint>}.
//
// --no-verify-jwt is deliberate, see the header of supabase_push.sql:
// claim_push() stamps pushed_at in the same statement it reads the row, so
// this endpoint is idempotent and can only ever deliver a notification to
// the recipient already written on it. There is nothing for an unauthorised
// caller to gain, and it keeps the database from having to hold a token.
//
// This file is inside supabase/, which functions/supabase/[[path]].js serves
// as 404 — it is never reachable on weavo.art (CLAUDE.md §3).

import webpush from "npm:web-push@3.6.7";

const SITE_URL = Deno.env.get("SITE_URL") ?? "https://weavo.art";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@weavo.art";
const FCM_SERVICE_ACCOUNT = Deno.env.get("FCM_SERVICE_ACCOUNT") ?? "";

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
}

// Same four types as the triggers in supabase_notifications.sql. Text is
// per device, from the language that device was registered in — there is no
// per-account language setting to read. Browsers and the app share this
// table so the wording is identical on both.
//
// TITLE IS A LABEL, NOT A SENTENCE. iOS gives the title one line and cuts
// it; every type used to begin with the same "{name}님이 회원님의…" and was
// truncated before the words that said what had actually happened, so a like
// and a comment were indistinguishable on the lock screen (2026-09-12). The
// label goes first, where nothing can cut it off, then the artwork's name —
// "which of my pieces is this about?" is the next thing the recipient wants
// to know, and the body is already spending its room on who said what.
// Nothing is appended when the artwork has no title or has been deleted.
type NotifText = {
  title: (artwork: string) => string;
  body: (actor: string, preview: string) => string;
};
const withArtwork = (label: string) => (artwork: string) => (artwork ? `${label} · ${artwork}` : label);
const TEXT: Record<string, Record<string, NotifText>> = {
  ko: {
    submission_like: {
      title: withArtwork("좋아요"),
      body: (a) => `${a}님이 내 작품을 좋아합니다`,
    },
    // "이름: 댓글 내용" — the shape every messaging app uses, and it puts the
    // words the recipient actually wants to read as early as possible.
    submission_comment: {
      title: withArtwork("새 댓글"),
      body: (a, p) => (p ? `${a}: ${p}` : `${a}님이 내 작품에 댓글을 남겼습니다`),
    },
    submission_reply: {
      title: withArtwork("새 답글"),
      body: (a, p) => (p ? `${a}: ${p}` : `${a}님이 내 댓글에 답글을 남겼습니다`),
    },
    follow: {
      title: () => "새 팔로워",
      body: (a) => `${a}님이 회원님을 팔로우하기 시작했습니다`,
    },
  },
  en: {
    submission_like: {
      title: withArtwork("Like"),
      body: (a) => `${a} liked your artwork`,
    },
    submission_comment: {
      title: withArtwork("New comment"),
      body: (a, p) => (p ? `${a}: ${p}` : `${a} commented on your artwork`),
    },
    submission_reply: {
      title: withArtwork("New reply"),
      body: (a, p) => (p ? `${a}: ${p}` : `${a} replied to your comment`),
    },
    follow: {
      title: () => "New follower",
      body: (a) => `${a} started following you`,
    },
  },
};
const ANON = { ko: "누군가", en: "Someone" };

type Claim = {
  type: string;
  preview: string | null;
  actor: string | null;
  submission_id: number | null;
  artwork?: string | null;
  unread?: number;
  subscriptions?: { endpoint: string; p256dh: string; auth: string; lang: string }[];
  tokens?: { token: string; platform: string | null; lang: string }[];
};

// One shape for both transports: a title, a body, and where tapping it goes.
function messageFor(claim: Claim, lang: string) {
  const l = lang === "en" ? "en" : "ko";
  const actor = claim.actor || ANON[l];
  const text = TEXT[l][claim.type];
  // preview is the artwork's title for a like, the first ~140 characters of
  // the comment for a comment or reply, and empty for a follow; artwork is
  // the piece it all happened on. Each TEXT entry words itself around both.
  const title = text ? text.title(claim.artwork || "") : "Weavo";
  const body = text ? text.body(actor, claim.preview || "") : "";
  const url = claim.submission_id
    ? `${SITE_URL}/${l}/artworks/${claim.submission_id}`
    : (claim.actor ? `${SITE_URL}/${l}/artists/${encodeURIComponent(claim.actor)}` : `${SITE_URL}/${l}/`);
  // One notification per subject per type: a second like on the same
  // artwork replaces the first instead of stacking.
  const tag = `${claim.type}:${claim.submission_id ?? claim.actor ?? ""}`;
  return { title, body, url, tag };
}

async function rpc(name: string, args: Record<string, unknown>) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
    },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`${name} failed: ${res.status} ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// ---------- FCM HTTP v1 ----------
// Access tokens are minted from the service account with a signed JWT rather
// than pulled in with google-auth-library: this is ~40 lines of Web Crypto
// against a dependency that would weigh on every cold start of a function
// whose whole job is one HTTP call.
type ServiceAccount = { client_email: string; private_key: string; project_id: string };
let serviceAccount: ServiceAccount | null = null;
if (FCM_SERVICE_ACCOUNT) {
  try {
    const parsed = JSON.parse(FCM_SERVICE_ACCOUNT);
    if (parsed?.client_email && parsed?.private_key && parsed?.project_id) serviceAccount = parsed;
    else console.error("FCM_SERVICE_ACCOUNT is missing client_email / private_key / project_id");
  } catch (e) {
    console.error("FCM_SERVICE_ACCOUNT is not valid JSON:", e);
  }
}

const b64url = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function signingKey(pem: string) {
  // The JSON carries the PEM with literal \n, which JSON.parse has already
  // turned into real newlines; strip the armour and decode the DER.
  const der = Uint8Array.from(
    atob(pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "")),
    (c) => c.charCodeAt(0),
  );
  return crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
}

// Kept for the life of the function instance — a token is good for an hour
// and minting one costs a round trip plus an RSA signature.
let accessToken: { value: string; expiresAt: number } | null = null;
async function fcmAccessToken(sa: ServiceAccount) {
  const now = Math.floor(Date.now() / 1000);
  if (accessToken && accessToken.expiresAt - 60 > now) return accessToken.value;

  const header = b64url(new TextEncoder().encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const claims = b64url(new TextEncoder().encode(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })));
  const key = await signingKey(sa.private_key);
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${header}.${claims}`),
  );
  const assertion = `${header}.${claims}.${b64url(signature)}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  if (!res.ok) throw new Error(`token endpoint ${res.status}: ${await res.text()}`);
  const json = await res.json();
  accessToken = { value: json.access_token, expiresAt: now + (json.expires_in ?? 3600) };
  return accessToken.value;
}

// The app displays notification.title/body and reads data.url to open the
// page (internal hosts only, hence the https://weavo.art prefix).
//
// THE BADGE IS SENT TWICE, and both are needed:
//   • data.badge — read by the app's own code, so it only lands while the app
//     is running or its background handler is alive. On its own the icon
//     stayed blank whenever the app had been quit (2026-09-12).
//   • aps.badge / notification_count — the platform sets the icon badge from
//     these without waking any app code, which is the only thing that works
//     when the app is fully closed.
// Sent even when unread is 0: that is how iOS is told to CLEAR the badge.
//
// Values under "data" must be strings; aps.badge and notification_count must
// be numbers. The Android channel and icon are the app's own defaults — not
// set here.
async function sendFcm(token: string, msg: ReturnType<typeof messageFor>, unread: number, sa: ServiceAccount) {
  const bearer = await fcmAccessToken(sa);
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${bearer}` },
    body: JSON.stringify({
      message: {
        token,
        notification: { title: msg.title, body: msg.body },
        data: { url: msg.url, badge: String(unread) },
        apns: { payload: { aps: { badge: unread } } },
        android: { notification: { notification_count: unread } },
      },
    }),
  });
  if (res.ok) return { ok: true, gone: false };
  const text = await res.text();
  // Only UNREGISTERED / 404 means the install is gone (uninstalled, or the
  // token rotated) — stop retrying that one forever. INVALID_ARGUMENT is
  // deliberately NOT treated that way: it also covers a malformed message,
  // and one mistake in the body above would otherwise delete every token in
  // the table on the first send.
  const gone = res.status === 404 || text.includes("UNREGISTERED");
  return { ok: false, gone, detail: `${res.status} ${text}` };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  let id: number | null = null;
  try { id = Number((await req.json())?.id); } catch { id = null; }
  if (!Number.isFinite(id)) return new Response("bad request", { status: 400 });

  // Claims the row: a repeat call for the same id returns null and sends
  // nothing, which is what makes this endpoint safe to leave open.
  let claim: Claim | null;
  try { claim = await rpc("claim_push", { p_id: id }); }
  catch (e) { console.error("claim_push error:", e); return new Response("claim failed", { status: 500 }); }
  if (!claim) return new Response(JSON.stringify({ sent: 0, reason: "nothing-to-send" }), { status: 200 });

  const unread = Number(claim.unread ?? 0);
  let webSent = 0, appSent = 0, dropped = 0;

  // ---------- browsers ----------
  if (VAPID_PUBLIC && VAPID_PRIVATE) {
    for (const sub of claim.subscriptions ?? []) {
      const msg = messageFor(claim, sub.lang);
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(msg),
          { TTL: 60 * 60 * 24 },   // a day-old "someone liked your artwork" is still worth showing
        );
        webSent++;
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          try { await rpc("drop_push_subscription", { p_endpoint: sub.endpoint }); dropped++; }
          catch (dropErr) { console.error("drop_push_subscription error:", dropErr); }
        } else {
          console.error(`push send failed (${status ?? "no status"}):`, e);
        }
      }
    }
  } else if ((claim.subscriptions ?? []).length) {
    console.error("VAPID keys are not set — browser subscriptions skipped");
  }

  // ---------- the app ----------
  if (serviceAccount) {
    for (const t of claim.tokens ?? []) {
      try {
        const res = await sendFcm(t.token, messageFor(claim, t.lang), unread, serviceAccount);
        if (res.ok) { appSent++; continue; }
        if (res.gone) {
          try { await rpc("drop_push_token", { p_token: t.token }); dropped++; }
          catch (dropErr) { console.error("drop_push_token error:", dropErr); }
        } else {
          console.error("fcm send failed:", res.detail);
        }
      } catch (e) {
        // A failure to mint a token would fail every send in this loop the
        // same way; log it and move on rather than losing the web half.
        console.error("fcm send error:", e);
      }
    }
  } else if ((claim.tokens ?? []).length) {
    console.error("FCM_SERVICE_ACCOUNT is not set — app tokens skipped");
  }

  return new Response(JSON.stringify({ webSent, appSent, dropped }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
