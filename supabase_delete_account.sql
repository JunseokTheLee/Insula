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
-- mosaic_submission_likes/saves, profile_comments — see supabase_profiles.sql,
-- supabase_mosaic.sql, supabase_mosaic_comments.sql, supabase_mosaic_likes.sql),
-- so deleting the auth.users row alone cleans up everything the user created.
-- mosaic_pixels.claimed_by uses "on delete set null" instead, so an
-- in-progress pixel claim is released rather than deleted.
--
-- Note: this does NOT remove files already uploaded to Storage (avatar /
-- artwork images) — the DB rows referencing them are gone, but the objects
-- themselves are left orphaned in the `artwork` bucket. Out of scope here;
-- revisit with a Storage cleanup pass if that becomes a problem.

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
