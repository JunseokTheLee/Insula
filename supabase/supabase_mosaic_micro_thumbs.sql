-- Run this once in the Supabase SQL editor (Project → SQL Editor → New query).
-- Run AFTER supabase_mosaic_thumbnails.sql and supabase_delete_account_storage.sql.
--
-- Artwork thumbnails, fixed and extended (2026-09-10).
--
-- 1. Storage policy for thumbnails. supabase_mosaic_thumbnails.sql assumed
--    the `artwork` bucket's existing upload policy covered the `thumb/`
--    prefix; it does not (it only allows `<uid>/…`), so every thumbnail
--    upload since 2026-08 was rejected and every piece fell back to its
--    full-size original. This adds an INSERT policy for `thumb/<uid>/…`
--    (own folder), and lets admins write into any `thumb/<uid>/` so the
--    admin page can rebuild missing thumbnails under the AUTHOR's folder —
--    where account deletion (supabase_delete_account_storage.sql) will find
--    them later.
-- 2. micro_thumb: a 16×16 JPEG as a data URI (~0.5 KB) per piece, stored in
--    the row itself so the campaign page can paint every filled cell as a
--    tiny picture at any zoom level with no extra requests.
-- 3. admin_set_submission_thumbs(): the admin page's backfill writes
--    thumb_url / micro_thumb of other people's pieces through this RPC
--    instead of a looser update policy.

-- ── 1. thumbnail uploads ────────────────────────────────────────────────
drop policy if exists "Users can upload their own thumbnails" on storage.objects;
create policy "Users can upload their own thumbnails"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'artwork'
    and (storage.foldername(name))[1] = 'thumb'
    and (
      (storage.foldername(name))[2] = auth.uid()::text
      or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
    )
  );

-- ── 2. micro thumbnails ─────────────────────────────────────────────────
alter table public.mosaic_submissions add column if not exists micro_thumb text;
alter table public.mosaic_submissions drop constraint if exists mosaic_submissions_micro_thumb_check;
alter table public.mosaic_submissions add constraint mosaic_submissions_micro_thumb_check
  check (micro_thumb is null or (micro_thumb like 'data:image/jpeg;base64,%' and length(micro_thumb) <= 4000));
grant insert (micro_thumb) on public.mosaic_submissions to authenticated;

-- ── 3. admin backfill ───────────────────────────────────────────────────
create or replace function public.admin_set_submission_thumbs(p_id bigint, p_thumb_url text, p_micro_thumb text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then
    raise exception 'only admins can set artwork thumbnails';
  end if;
  if p_thumb_url is not null and p_thumb_url not like '%/storage/v1/object/public/artwork/%' then
    raise exception 'thumb_url must point into the artwork bucket';
  end if;
  update public.mosaic_submissions
  set thumb_url = coalesce(p_thumb_url, thumb_url),
      micro_thumb = coalesce(p_micro_thumb, micro_thumb)
  where id = p_id;
  if not found then
    raise exception 'submission % not found', p_id;
  end if;
end;
$$;

revoke execute on function public.admin_set_submission_thumbs(bigint, text, text) from public;
grant execute on function public.admin_set_submission_thumbs(bigint, text, text) to authenticated; -- gated to admins inside
