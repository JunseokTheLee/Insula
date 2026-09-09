-- Run this once in the Supabase SQL editor (Project → SQL Editor → New query).
-- Run AFTER supabase_mosaic_likes.sql.
--
-- Like counts on the artwork row (2026-09-10). The Browse Artworks page used
-- to fetch every like row for every artwork on the page and count them in
-- the browser — fine for 21 pieces, but the `in(id, id, …)` request breaks
-- at a few hundred ids and Supabase caps the rows at 1,000 anyway. This
-- keeps mosaic_submissions.like_count current from a trigger on
-- mosaic_submission_likes, so pages can read and ORDER BY it directly.
--
-- Clients cannot set it: a BEFORE trigger forces 0 on insert and restores
-- the old value on update unless the like trigger (which runs as the table
-- owner and flags the transaction) is the one writing.

alter table public.mosaic_submissions add column if not exists like_count integer not null default 0;
create index if not exists mosaic_submissions_like_count_idx on public.mosaic_submissions (like_count desc, created_at desc);
create index if not exists mosaic_submissions_created_at_idx on public.mosaic_submissions (created_at desc, id desc);

-- ── guard: only the like trigger may change like_count ──────────────────
create or replace function public.mosaic_submissions_guard_like_count()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    new.like_count := 0;
  elsif new.like_count is distinct from old.like_count
        and coalesce(current_setting('weavo.like_count_update', true), '') <> 'on' then
    new.like_count := old.like_count;
  end if;
  return new;
end;
$$;
drop trigger if exists mosaic_submissions_guard_like_count on public.mosaic_submissions;
create trigger mosaic_submissions_guard_like_count
  before insert or update on public.mosaic_submissions
  for each row execute function public.mosaic_submissions_guard_like_count();

-- ── maintenance: recount after every like / unlike ──────────────────────
create or replace function public.mosaic_submission_likes_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id bigint := coalesce(new.submission_id, old.submission_id);
begin
  perform set_config('weavo.like_count_update', 'on', true);
  update public.mosaic_submissions s
  set like_count = (select count(*) from public.mosaic_submission_likes l where l.submission_id = v_id)
  where s.id = v_id;
  perform set_config('weavo.like_count_update', '', true);
  return null;
end;
$$;
drop trigger if exists mosaic_submission_likes_count on public.mosaic_submission_likes;
create trigger mosaic_submission_likes_count
  after insert or delete on public.mosaic_submission_likes
  for each row execute function public.mosaic_submission_likes_count();

-- ── backfill (idempotent) ───────────────────────────────────────────────
do $$
begin
  perform set_config('weavo.like_count_update', 'on', true);
  update public.mosaic_submissions s
  set like_count = coalesce((select count(*) from public.mosaic_submission_likes l where l.submission_id = s.id), 0);
  perform set_config('weavo.like_count_update', '', true);
end;
$$;
