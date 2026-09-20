-- Run this once in the Supabase SQL editor (Project → SQL Editor → New query).
-- Run AFTER supabase_push_tokens.sql (this redefines its claim_push) and
-- after supabase_admin_moderation.sql (it calls admin_log_action).
--
-- Admin announcements: one message from the site to every member, shown in
-- the notification bell and pushed to whatever devices they registered.
--
-- It deliberately reuses the EXISTING delivery path rather than adding a
-- second one: the broadcast writes one notifications row per member, and the
-- AFTER INSERT trigger from supabase_push.sql fans those out exactly the way
-- a like or a comment already does. Nothing about the per-event path changes,
-- and an announcement cannot break it.
--
--   admin_broadcast_notification(title, body)
--     → one notifications row per profile  (the bell, for everyone)
--     → the pg_net trigger POSTs {id} per row  (unchanged)
--     → functions/push/index.ts sends to that member's devices  (unchanged)
--
-- SCALE NOTE: one Edge Function call per recipient. At 34 members (2026-09-13)
-- that is 34 calls against a 2,000,000/month allowance — irrelevant. If the
-- membership ever reaches the tens of thousands, revisit this: the fan-out
-- would want to become one call that reads every device at once, rather than
-- tens of thousands of pg_net requests queued inside a single statement.

-- ── 1. notifications: an announcement type, and a title to carry ─────────
-- Announcements are the only notification whose words are written by a
-- person instead of assembled from a template, so they need somewhere to put
-- the headline. Every other type leaves this null.
alter table public.notifications add column if not exists title text;

-- The type CHECK is recreated rather than altered — Postgres has no "add a
-- value to a check constraint".
--
-- The old constraint is found by what it CONTAINS, not by name. Its name is
-- whatever Postgres generated when supabase_notifications.sql wrote its
-- inline type check, and guessing it wrong would be the worst
-- kind of failure here: the drop would silently do nothing, the add would
-- collide or not, and announcements would be rejected at insert time long
-- after this file appeared to succeed. Matching on the definition also makes
-- re-running this file safe — it finds and replaces its own constraint too.
do $mig$
declare
  v_name text;
begin
  for v_name in
    select conname from pg_constraint
    where conrelid = 'public.notifications'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%submission_like%'
  loop
    execute format('alter table public.notifications drop constraint %I', v_name);
  end loop;
end
$mig$;

alter table public.notifications add constraint notifications_type_check
  check (type in (
    'submission_like', 'submission_comment', 'submission_reply', 'follow', 'announcement',
    'medal_changed', 'pixel_complete'
  ));

-- ── 2. admin_broadcast_notification ─────────────────────────────────────
-- Security definer because the browser cannot insert notifications at all:
-- rows are written only by triggers and by this function (see the comment at
-- the top of supabase_notifications.sql — the publishable key must never be
-- able to address a row to someone else).
--
-- Length limits are enforced HERE, not just in the admin page, for the same
-- reason: the anon key can call an RPC directly. They are also what keeps a
-- push notification readable — iOS gives the title one line.
create or replace function public.admin_broadcast_notification(
  p_title text,
  p_body  text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_title text := btrim(coalesce(p_title, ''));
  v_body  text := btrim(coalesce(p_body, ''));
  v_count integer;
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'admin only';
  end if;
  if v_title = '' then
    raise exception 'title required';
  end if;
  if char_length(v_title) > 80 then
    raise exception 'title too long';
  end if;
  if char_length(v_body) > 500 then
    raise exception 'body too long';
  end if;

  -- Every member, including the admin sending it — seeing your own
  -- announcement arrive is the simplest confirmation that it went out.
  insert into public.notifications (recipient_id, actor_id, type, title, preview)
  select p.id, auth.uid(), 'announcement', v_title, nullif(v_body, '')
  from public.profiles p;

  get diagnostics v_count = row_count;

  -- Append-only record of who sent what to how many people. A broadcast
  -- cannot be recalled, so the log is the only account of it afterwards.
  perform public.admin_log_action(
    'broadcast', 'notification', null,
    jsonb_build_object('title', v_title, 'recipients', v_count)
  );

  return v_count;
end;
$fn$;

revoke execute on function public.admin_broadcast_notification(text, text) from public, anon;
grant execute on function public.admin_broadcast_notification(text, text) to authenticated;

-- ── 3. claim_push, carrying the announcement title ──────────────────────
-- Replaces the version in supabase_push_tokens.sql. The ONLY change is the
-- two new fields: 'title' (the announcement headline) and 'id' (so the push
-- can tag each announcement separately instead of replacing the last one).
-- Everything else is copied verbatim so this file stands alone.
--
-- NOTE: claim_push now lives in THREE files — supabase_push.sql,
-- supabase_push_tokens.sql and this one. THIS is the newest. If either of
-- the other two is ever re-run, re-run this file afterwards or announcement
-- pushes go out with an empty title.
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
    'id',            v_row.id,
    'type',          v_row.type,
    'preview',       v_row.preview,
    -- Written by an admin for an announcement, null for every other type,
    -- which builds its words from a template in the Edge Function instead.
    'title',         v_row.title,
    'actor',         v_actor,
    'submission_id', v_row.submission_id,
    -- Which artwork this is about, so the notification can say so: a comment
    -- alert that only reads "someone: nice!" leaves the recipient guessing
    -- which of their pieces it landed on. Null for a follow, and null once
    -- the artwork is deleted — the sender words around that.
    'artwork',       (select s.art_title from public.mosaic_submissions s where s.id = v_row.submission_id),
    'unread',        v_unread,
    'subscriptions', v_subs,
    'tokens',        v_tokens
  );
end;
$fn$;

-- Unchanged: the function hands out push endpoints and tokens, which are
-- capabilities.
revoke execute on function public.claim_push(bigint) from public, anon, authenticated;
grant execute on function public.claim_push(bigint) to service_role;
