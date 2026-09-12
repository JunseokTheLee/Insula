-- Run this once in the Supabase SQL editor (Project → SQL Editor → New query).
-- Run AFTER supabase_push.sql (this redefines its claim_push and reuses the
-- dispatch trigger and pushed_at column it created).
--
-- The Weavo mobile app (Flutter, package art.weavo.app) is a WebView
-- container, and a WebView has no Web Push API — the browser push added on
-- 2026-09-11 never reaches it. The app receives through FCM instead, so it
-- registers an FCM token here and the same Edge Function sends to both:
--
--   notifications INSERT
--     → the pg_net trigger from supabase_push.sql POSTs {id} (unchanged)
--     → supabase/functions/push/index.ts calls claim_push(id) once and gets
--       BOTH the browser subscriptions and the app tokens
--     → Web Push to the browsers, FCM HTTP v1 to the app installs.
--
-- Nothing about the browser path changes. This file only adds a table, two
-- functions, and a wider claim_push.

-- ── 1. push_tokens ───────────────────────────────────────────────────────
-- One row per app install. The FCM token is the natural key: it belongs to
-- the INSTALL, not the account, so on a shared phone the same token comes
-- back under a different user — see save_push_token below.
create table if not exists public.push_tokens (
  token      text primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  platform   text,
  -- Which language this install asked for, so the message text matches the
  -- pages that user actually reads (same reason as push_subscriptions.lang).
  lang       text not null default 'ko' check (lang in ('ko', 'en')),
  updated_at timestamptz not null default now()
);

create index if not exists push_tokens_user_idx on public.push_tokens (user_id);

alter table public.push_tokens enable row level security;

-- Nobody reads anyone else's token: a push token is a capability — whoever
-- holds it can notify that device.
drop policy if exists "Users read their own push tokens" on public.push_tokens;
create policy "Users read their own push tokens"
  on public.push_tokens for select
  using (user_id = auth.uid());

-- Sign-out removes this device's row (js/push.js forgetAppPushToken), so a
-- shared phone stops getting the previous account's notifications.
drop policy if exists "Users delete their own push tokens" on public.push_tokens;
create policy "Users delete their own push tokens"
  on public.push_tokens for delete
  using (user_id = auth.uid());

-- Registering goes through save_push_token below, never a direct insert or
-- update. Supabase grants ALL on new public tables to anon and authenticated
-- by default, so revoke first and grant only what is actually used (the rule
-- in CLAUDE.md §6).
revoke all on public.push_tokens from anon, authenticated;
grant select, delete on public.push_tokens to authenticated;

-- ── 2. save_push_token: "this install is mine now" ───────────────────────
-- Same problem and same answer as save_push_subscription in supabase_push.sql:
-- two accounts sharing one phone produce the SAME token, and a plain upsert
-- would be refused by the row-owner policy, leaving the newcomer silently
-- without notifications. Hand the token over instead — the device really is
-- signed in as someone else now.
create or replace function public.save_push_token(
  p_token    text,
  p_platform text default null,
  p_lang     text default 'ko'
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if auth.uid() is null then
    raise exception 'sign-in required';
  end if;
  if coalesce(p_token, '') = '' then
    raise exception 'token required';
  end if;

  insert into public.push_tokens (token, user_id, platform, lang, updated_at)
  values (p_token, auth.uid(), left(p_platform, 20),
          case when p_lang = 'en' then 'en' else 'ko' end, now())
  on conflict (token) do update
    set user_id    = excluded.user_id,
        platform   = excluded.platform,
        lang       = excluded.lang,
        updated_at = now();
end;
$fn$;

revoke execute on function public.save_push_token(text, text, text) from public, anon;
grant execute on function public.save_push_token(text, text, text) to authenticated;

-- ── 3. drop_push_token: retire a token FCM rejected ──────────────────────
-- An UNREGISTERED / 404 from FCM means the app was uninstalled or the token
-- rotated; keeping it would retry forever. Same pattern as
-- drop_push_subscription.
create or replace function public.drop_push_token(p_token text)
returns void
language sql
security definer
set search_path = public
as $fn$
  delete from public.push_tokens where token = p_token;
$fn$;

revoke execute on function public.drop_push_token(text) from public, anon, authenticated;
grant execute on function public.drop_push_token(text) to service_role;

-- ── 4. claim_push, widened ───────────────────────────────────────────────
-- Replaces the version in supabase_push.sql. Two changes:
--
--   • It also returns the recipient's app tokens, and it now returns null
--     ONLY when there is neither a browser subscription nor an app token.
--     The old version returned null as soon as the subscription list was
--     empty — but it had ALREADY stamped pushed_at, so an app-only user
--     would never have been notified, and the row could not be retried.
--     That is why this correction matters more than it looks.
--
--   • It returns the recipient's unread count, which the app puts on its
--     icon badge. Counted after this row exists (the dispatch trigger is
--     AFTER INSERT), so the new notification is included.
create or replace function public.claim_push(p_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_row    public.notifications;
  v_actor  text;
  v_subs   jsonb;
  v_tokens jsonb;
  v_unread integer;
begin
  update public.notifications
     set pushed_at = now()
   where id = p_id and pushed_at is null
  returning * into v_row;

  if v_row.id is null then
    return null;                                  -- unknown id, or already sent
  end if;

  select coalesce(username, name) into v_actor
  from public.profiles where id = v_row.actor_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth, 'lang', s.lang)), '[]'::jsonb)
    into v_subs
  from public.push_subscriptions s
  where s.user_id = v_row.recipient_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'token', t.token, 'platform', t.platform, 'lang', t.lang)), '[]'::jsonb)
    into v_tokens
  from public.push_tokens t
  where t.user_id = v_row.recipient_id;

  if jsonb_array_length(v_subs) = 0 and jsonb_array_length(v_tokens) = 0 then
    return null;                                  -- no browser and no app
  end if;

  select count(*) into v_unread
  from public.notifications n
  where n.recipient_id = v_row.recipient_id and n.read_at is null;

  return jsonb_build_object(
    'type',          v_row.type,
    'preview',       v_row.preview,
    'actor',         v_actor,
    'submission_id', v_row.submission_id,
    'unread',        v_unread,
    'subscriptions', v_subs,
    'tokens',        v_tokens
  );
end;
$fn$;

-- Unchanged from supabase_push.sql, repeated so this file stands alone:
-- the function hands out push endpoints and tokens, which are capabilities.
revoke execute on function public.claim_push(bigint) from public, anon, authenticated;
grant execute on function public.claim_push(bigint) to service_role;
