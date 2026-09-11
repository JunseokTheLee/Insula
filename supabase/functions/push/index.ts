// Supabase Edge Function "push" — delivers one notification row as a Web
// Push message to every device its recipient has registered.
//
// Deploy:  supabase functions deploy push --no-verify-jwt
// Secrets: supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:...
//          (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by the platform)
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

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
}

// Same four types as the triggers in supabase_notifications.sql. Text is
// per device, from the language that device was registered in — there is no
// per-account language setting to read.
const TEXT: Record<string, Record<string, (actor: string) => string>> = {
  ko: {
    submission_like: (a) => `${a}님이 회원님의 작품을 좋아합니다`,
    submission_comment: (a) => `${a}님이 회원님의 작품에 댓글을 남겼습니다`,
    submission_reply: (a) => `${a}님이 회원님의 댓글에 답글을 남겼습니다`,
    follow: (a) => `${a}님이 회원님을 팔로우합니다`,
  },
  en: {
    submission_like: (a) => `${a} liked your artwork`,
    submission_comment: (a) => `${a} commented on your artwork`,
    submission_reply: (a) => `${a} replied to your comment`,
    follow: (a) => `${a} started following you`,
  },
};
const ANON = { ko: "누군가", en: "Someone" };

function buildPayload(
  claim: { type: string; preview: string | null; actor: string | null; submission_id: number | null },
  lang: string,
) {
  const l = lang === "en" ? "en" : "ko";
  const actor = claim.actor || ANON[l];
  const line = TEXT[l][claim.type];
  const title = line ? line(actor) : "Weavo";
  // A like carries the artwork title in `preview`, a comment the first ~140
  // characters of the body — both are fine as the notification body.
  const body = claim.type === "follow" ? "" : (claim.preview || "");
  const url = claim.submission_id
    ? `${SITE_URL}/${l}/artworks/${claim.submission_id}`
    : (claim.actor ? `${SITE_URL}/${l}/artists/${encodeURIComponent(claim.actor)}` : `${SITE_URL}/${l}/`);
  // One notification per subject per type: a second like on the same
  // artwork replaces the first instead of stacking.
  const tag = `${claim.type}:${claim.submission_id ?? claim.actor ?? ""}`;
  return JSON.stringify({ title, body, url, tag });
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

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    console.error("VAPID keys are not set — nothing can be delivered");
    return new Response(JSON.stringify({ sent: 0, reason: "no-vapid-keys" }), { status: 200 });
  }

  let id: number | null = null;
  try { id = Number((await req.json())?.id); } catch { id = null; }
  if (!Number.isFinite(id)) return new Response("bad request", { status: 400 });

  // Claims the row: a repeat call for the same id returns null and sends
  // nothing, which is what makes this endpoint safe to leave open.
  let claim;
  try { claim = await rpc("claim_push", { p_id: id }); }
  catch (e) { console.error("claim_push error:", e); return new Response("claim failed", { status: 500 }); }
  if (!claim) return new Response(JSON.stringify({ sent: 0, reason: "nothing-to-send" }), { status: 200 });

  let sent = 0;
  let dropped = 0;
  for (const sub of claim.subscriptions ?? []) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        buildPayload(claim, sub.lang),
        { TTL: 60 * 60 * 24 },   // a day-old "someone liked your artwork" is still worth showing
      );
      sent++;
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      // 404/410: the browser is gone for good — stop retrying it forever.
      if (status === 404 || status === 410) {
        try { await rpc("drop_push_subscription", { p_endpoint: sub.endpoint }); dropped++; }
        catch (dropErr) { console.error("drop_push_subscription error:", dropErr); }
      } else {
        console.error(`push send failed (${status ?? "no status"}):`, e);
      }
    }
  }

  return new Response(JSON.stringify({ sent, dropped }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
