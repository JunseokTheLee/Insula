-- Run this once in the Supabase SQL editor (Project → SQL Editor → New query).
-- Companion to supabase_delete_account.sql — that RPC only deletes database
-- rows (cascades handle mosaic_submissions etc.), since a plain SQL function
-- has no way to reach the Storage API and delete the actual uploaded files.
--
-- js/auth.js's account-deletion handler now removes a user's own files from
-- the `artwork` bucket client-side, right before calling delete_own_account()
-- (it has to happen before, not after — once the account RPC succeeds,
-- auth.uid() no longer resolves to anything these policies can match). That
-- needs RLS policies letting an authenticated user list and delete objects
-- under their own prefix — every artwork/avatar upload already goes through
-- common.js's uploadImage(), which paths originals as `${uid}/...` and (per
-- supabase_mosaic_thumbnails.sql) thumbnails as `thumb/${uid}/...`.
--
-- These are additive: they don't touch whatever policy already lets anyone
-- read/upload to this bucket (it was set up via the dashboard, not tracked
-- here) — only grants list/delete scoped to a user's own two prefixes.

drop policy if exists "Users can list their own artwork files" on storage.objects;
create policy "Users can list their own artwork files"
  on storage.objects for select
  using (
    bucket_id = 'artwork'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or ((storage.foldername(name))[1] = 'thumb' and (storage.foldername(name))[2] = auth.uid()::text)
    )
  );

drop policy if exists "Users can delete their own artwork files" on storage.objects;
create policy "Users can delete their own artwork files"
  on storage.objects for delete
  using (
    bucket_id = 'artwork'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or ((storage.foldername(name))[1] = 'thumb' and (storage.foldername(name))[2] = auth.uid()::text)
    )
  );
