-- Run this once in the Supabase SQL editor (Project → SQL Editor → New query).
-- Run it after supabase_admin_moderation.sql (it uses admin_log_action and
-- the admin_audit_log table) and supabase_delete_account.sql.
--
-- Lets an admin delete an INCOMPLETE sign-up from the admin page's
-- "Members" tab (2026-10-01, user decision — the one exception to
-- CLAUDE.md §13 "admins never delete other people's accounts").
--
-- What "incomplete" means: someone signed in with Google/Apple, the site
-- made their bare profile row (js/auth.js upsertBaseProfile), and they left
-- the forced username form — "Not now", or simply closed the app. The row
-- stays with no username and nothing else. These pile up in the admin
-- "New members" list as "(no name)".
--
-- The function re-checks EVERY condition itself, so calling it straight
-- from the browser console with any id cannot delete a real member:
--   * the caller is an admin;
--   * the target has no username (never finished sign-up);
--   * the target is not an admin;
--   * the profile is more than 24 hours old (never delete someone who is
--     filling in the form right now);
--   * the target has no artworks and no comments.
-- One account per call — there is no bulk version, and none should be added.
-- Each deletion is written to admin_audit_log ('incomplete_account_delete').
--
-- Deleting the auth.users row cascades to profiles and every other table
-- that references the user (see supabase_delete_account.sql). An incomplete
-- account has no Storage files of its own: the avatar is the OAuth photo URL.

create or replace function public.admin_delete_incomplete_account(p_user uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_profile public.profiles%rowtype;
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'admin only';
  end if;
  if p_user is null then
    raise exception 'user id required';
  end if;
  if p_user = auth.uid() then
    raise exception 'cannot delete own account here';
  end if;

  select * into v_profile from public.profiles where id = p_user;
  if not found then
    raise exception 'profile not found';
  end if;
  if v_profile.username is not null and btrim(v_profile.username) <> '' then
    raise exception 'not an incomplete sign-up: username is set';
  end if;
  if coalesce(v_profile.is_admin, false) then
    raise exception 'not an incomplete sign-up: admin account';
  end if;
  if v_profile.created_at > now() - interval '24 hours' then
    raise exception 'too recent: sign-up may still be in progress';
  end if;
  if exists (select 1 from public.mosaic_submissions where author_id = p_user) then
    raise exception 'not an incomplete sign-up: has artworks';
  end if;
  if exists (select 1 from public.mosaic_submission_comments where author_id = p_user) then
    raise exception 'not an incomplete sign-up: has comments';
  end if;

  -- Logged first, while the profile row (and its created_at) still exists.
  perform public.admin_log_action(
    'incomplete_account_delete',
    'profile',
    p_user::text,
    jsonb_build_object('created_at', v_profile.created_at)
  );

  delete from auth.users where id = p_user;
  return true;
end;
$fn$;

revoke all on function public.admin_delete_incomplete_account(uuid) from public;
revoke all on function public.admin_delete_incomplete_account(uuid) from anon;
grant execute on function public.admin_delete_incomplete_account(uuid) to authenticated;
