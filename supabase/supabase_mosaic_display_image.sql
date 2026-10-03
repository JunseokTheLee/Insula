-- Run this once in the Supabase SQL editor (Project → SQL Editor → New query).
-- Run AFTER supabase_mosaic_micro_thumbs.sql, supabase_delete_account_storage.sql
-- and supabase_admin_moderation.sql. Idempotent — safe to run again.
--
-- "Display" images for the lightbox (2026-10-03).
--
-- The lightbox used to sharpen only once the artist's ORIGINAL file had
-- downloaded — 1.6 MB on average, up to 3 MB (measured 2026-10-03 on the
-- latest 12 artworks), i.e. seconds on a phone. It now loads a display copy
-- instead: longer side ≤ 1600 px, JPEG, ~0.2–0.4 MB, made in the browser at
-- upload time (js/common.js artworkDerivativesFromImage), next to the 480 px
-- thumbnail. The original is still kept and still downloadable; only the
-- lightbox stops waiting for it.
--
-- The file's path is derived from the original's: artwork/<uid>/<name>.<ext>
-- → artwork/display/<uid>/<name>.jpg (js/common.js artworkDisplayPath). So
-- list queries need no new column: the lightbox computes the address and
-- falls back to the original when the file is not there yet. display_url
-- records which artworks have one, so the admin page can count and build
-- the missing ones ("작품 처리 → 보기용 이미지").
--
-- 1. Storage: upload into display/<own uid>/ (admins: any uid, for the
--    backfill — under the AUTHOR's folder so account deletion finds them),
--    and list/delete of one's own display/ folder for account deletion.
-- 2. mosaic_submissions.display_url + insert grant.
-- 3. admin_set_submission_display() for the backfill.

-- ── 1. storage ──────────────────────────────────────────────────────────
drop policy if exists "Users can upload their own display images" on storage.objects;
create policy "Users can upload their own display images"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'artwork'
    and (storage.foldername(name))[1] = 'display'
    and (
      (storage.foldername(name))[2] = auth.uid()::text
      or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
    )
  );

-- Same two policies as supabase_delete_account_storage.sql, with display/
-- added, so deleting one's account removes these files too.
drop policy if exists "Users can list their own artwork files" on storage.objects;
create policy "Users can list their own artwork files"
  on storage.objects for select
  using (
    bucket_id = 'artwork'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or ((storage.foldername(name))[1] in ('thumb', 'display') and (storage.foldername(name))[2] = auth.uid()::text)
    )
  );

drop policy if exists "Users can delete their own artwork files" on storage.objects;
create policy "Users can delete their own artwork files"
  on storage.objects for delete
  using (
    bucket_id = 'artwork'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or ((storage.foldername(name))[1] in ('thumb', 'display') and (storage.foldername(name))[2] = auth.uid()::text)
    )
  );

-- ── 2. column ───────────────────────────────────────────────────────────
alter table public.mosaic_submissions add column if not exists display_url text;
alter table public.mosaic_submissions drop constraint if exists mosaic_submissions_display_url_check;
alter table public.mosaic_submissions add constraint mosaic_submissions_display_url_check
  check (display_url is null or display_url like '%/storage/v1/object/public/artwork/display/%');
grant insert (display_url) on public.mosaic_submissions to authenticated;

-- ── 3. admin backfill ───────────────────────────────────────────────────
create or replace function public.admin_set_submission_display(p_id bigint, p_display_url text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then
    raise exception 'only admins can set artwork display images';
  end if;
  if p_display_url is null or p_display_url not like '%/storage/v1/object/public/artwork/display/%' then
    raise exception 'display_url must point into the artwork bucket display/ folder';
  end if;
  update public.mosaic_submissions set display_url = p_display_url where id = p_id;
  if not found then
    raise exception 'submission % not found', p_id;
  end if;
end;
$$;

revoke execute on function public.admin_set_submission_display(bigint, text) from public;
grant execute on function public.admin_set_submission_display(bigint, text) to authenticated; -- gated to admins inside
