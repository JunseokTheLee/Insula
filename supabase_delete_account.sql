-- Run this once in the Supabase SQL editor (Project → SQL Editor → New query).
--
-- Lets a signed-in user permanently delete their own account from the app
-- (index.html's edit-profile modal). The Supabase client SDK has no
-- self-serve "delete my account" call — actual user deletion only exists on
-- the admin API, which needs the service-role key and must never ship to a
-- browser. Wrapping `delete from auth.users` in a SECURITY DEFINER function
-- scoped to auth.uid() is the standard workaround for a client-only app.
--
-- Every table that references auth.users(id) here does so with
-- "on delete cascade" (profiles, mosaic_submissions, mosaic_submission_comments,
-- mosaic_submission_likes, profile_comments, user_saves — see
-- supabase_profiles.sql, supabase_mosaic.sql, supabase_mosaic_comments.sql,
-- supabase_mosaic_likes.sql, supabase_user_saves.sql), so deleting the
-- auth.users row alone cleans up everything the user created.
-- mosaic_pixels.claimed_by uses "on delete set null" instead, so an
-- in-progress pixel claim is released rather than deleted.
--
-- Note: this function only cleans up database rows — Storage objects (avatar
-- / artwork images, both full-res and thumbnails) live outside Postgres
-- proper and aren't reachable from plain SQL, so they're removed client-side
-- instead, right before this RPC is called (see js/auth.js's ep-delete-account
-- handler). That client-side removal needs the RLS policies added in
-- supabase_delete_account_storage.sql (run that file too, if you haven't).

create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'must be signed in to delete account';
  end if;

  delete from auth.users where id = v_uid;
end;
$$;

revoke all on function public.delete_own_account() from public;
grant execute on function public.delete_own_account() to authenticated;
