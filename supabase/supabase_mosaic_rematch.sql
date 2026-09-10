-- Run this once in the Supabase SQL editor (Project → SQL Editor → New query).
-- Run AFTER supabase_mosaic.sql and supabase_mosaic_profile_pool.sql.
--
-- "Option A" periodic re-matching of poorly-placed artwork. There's no
-- cron/server in this stack, so instead js/matching.js's runPoolMatching()
-- — already triggered after every upload / project change — first runs a
-- throttled cleanup pass: any *placed* piece whose average color is too far
-- from its cell (judged on the client with js/color-engine.js's Lab metric)
-- is released back to the profile pool, then the normal greedy match
-- re-places it — into a better cell if one exists now, or leaving it pooled
-- until one does.
--
-- This targets placements that predate the current POOR_MATCH_DISTANCE (it
-- used to be looser) and ones forced in by a reshape, which applies no
-- match-quality floor at all — the "really blue piece in a white cell" case.

-- ── singleton state row for the cross-visitor throttle ──────────────────
create table if not exists public.mosaic_meta (
  id               boolean primary key default true,
  last_rematch_at  timestamptz not null default 'epoch',
  constraint mosaic_meta_singleton check (id)
);
insert into public.mosaic_meta (id) values (true) on conflict (id) do nothing;

alter table public.mosaic_meta enable row level security;
drop policy if exists "mosaic_meta is readable by everyone" on public.mosaic_meta;
create policy "mosaic_meta is readable by everyone"
  on public.mosaic_meta for select using (true);
grant select on public.mosaic_meta to anon, authenticated;
-- No insert/update/delete grant: last_rematch_at only ever moves via
-- claim_rematch_slot() below (security definer, so it bypasses that).

-- ── claim_rematch_slot: atomically "win" the right to run a cleanup pass ─
-- Returns true to exactly one caller per p_min_interval; every other caller
-- in that window gets false and skips the scan. The check-and-set is a
-- single UPDATE ... WHERE so two tabs racing can't both win.
create or replace function public.claim_rematch_slot(p_min_interval interval)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return false;
  end if;
  update public.mosaic_meta
  set last_rematch_at = now()
  where id = true and now() - last_rematch_at >= p_min_interval;
  return found;
end;
$$;

revoke execute on function public.claim_rematch_slot(interval) from public;
grant execute on function public.claim_rematch_slot(interval) to authenticated;

-- ── unmatch_submissions: batch-release placed pieces back to the pool ────
-- Like unmatch_submission (supabase_mosaic_profile_pool.sql) but (a) takes
-- a list and (b) is callable by any signed-in user, not just the author or
-- an admin — the cleanup pass on any visitor's page has to be able to
-- release anyone's stuck piece.
--
-- Guard against misuse: a piece is only released if its average color is a
-- meaningful straight-RGB distance (> 15 units) from its cell's target.
-- That's a coarse server-side sanity check, NOT the real match-quality
-- test (which stays on the client, in js/color-engine.js's Lab metric) —
-- its only job is to make it impossible to yank a well-matched piece out
-- of a project by passing an arbitrary id list. A genuine poor match is
-- far past 15 RGB units; a good one is near zero.
create or replace function public.unmatch_submissions(p_ids bigint[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_released integer := 0;
begin
  if auth.uid() is null then
    raise exception 'must be signed in';
  end if;
  if p_ids is null or array_length(p_ids, 1) is null then
    return 0;
  end if;
  if array_length(p_ids, 1) > 5000 then
    raise exception 'rematch batch too large';
  end if;

  with releasable as (
    select s.id as submission_id, s.pixel_id
    from public.mosaic_submissions s
    join public.mosaic_pixels px on px.id = s.pixel_id
    where s.id = any (p_ids)
      and s.pixel_id is not null
      and (
        power(s.avg_r - px.target_r, 2) +
        power(s.avg_g - px.target_g, 2) +
        power(s.avg_b - px.target_b, 2)
      ) > 225   -- (15 RGB units)^2
  ),
  reopened as (
    update public.mosaic_pixels px
    set filled = false, submission_id = null, claimed_by = null, claimed_at = null
    from releasable r
    where px.id = r.pixel_id
    returning r.submission_id
  )
  update public.mosaic_submissions s
  set project_id = null, pixel_id = null
  from reopened ro
  where s.id = ro.submission_id;

  get diagnostics v_released = row_count;
  return v_released;
end;
$$;

revoke execute on function public.unmatch_submissions(bigint[]) from public;
grant execute on function public.unmatch_submissions(bigint[]) to authenticated;
