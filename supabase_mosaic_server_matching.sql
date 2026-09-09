-- Run this once in the Supabase SQL editor (Project → SQL Editor → New query).
-- Run AFTER supabase_mosaic_rematch.sql (uses claim_rematch_slot and
-- unmatch_submissions) and supabase_mosaic_profile_pool.sql.
--
-- Server-side artwork matching (2026-09-10). Until now every upload made the
-- uploader's browser download EVERY open cell of every active campaign
-- (0.6 MB at 5,000 cells, ~2 MB at 30,000) and pick the closest one by
-- color, then hand the result back to commit_pool_matches(). This moves that
-- whole pass into the database: match_pool_artworks() places every pooled
-- piece into its closest open cell (same Lab metric, same 0.2 lightness
-- weight, same "no fit above 30" rule as js/color-engine.js) and returns
-- only what it placed. Nothing about the grids leaves the database.
--
-- To keep the distance query cheap, the Lab coordinates of every cell's
-- target color and every artwork's average color are stored once (three
-- real columns, kept current by triggers) instead of being recomputed from
-- RGB for every comparison.
--
-- Also here: release_poor_matches() — the server twin of the client's
-- 6-hourly cleanup — and admin_usage_stats() for the admin page.

-- ── 1. Lab conversion — a straight port of rgbToLab() in js/color-engine.js ──
create or replace function public.rgb_to_lab(r double precision, g double precision, b double precision)
returns double precision[]
language sql
immutable
as $$
  with lin as (
    select
      case when r / 255.0 <= 0.04045 then r / 255.0 / 12.92 else power((r / 255.0 + 0.055) / 1.055, 2.4) end as lr,
      case when g / 255.0 <= 0.04045 then g / 255.0 / 12.92 else power((g / 255.0 + 0.055) / 1.055, 2.4) end as lg,
      case when b / 255.0 <= 0.04045 then b / 255.0 / 12.92 else power((b / 255.0 + 0.055) / 1.055, 2.4) end as lb
  ), xyz as (
    select (lr * 0.4124564 + lg * 0.3575761 + lb * 0.1804375) / 0.95047 as x,
           (lr * 0.2126729 + lg * 0.7151522 + lb * 0.0721750) / 1.0     as y,
           (lr * 0.0193339 + lg * 0.1191920 + lb * 0.9503041) / 1.08883 as z
    from lin
  ), f as (
    select case when x > 0.008856 then cbrt(x) else (x * 903.3 + 16) / 116 end as fx,
           case when y > 0.008856 then cbrt(y) else (y * 903.3 + 16) / 116 end as fy,
           case when z > 0.008856 then cbrt(z) else (z * 903.3 + 16) / 116 end as fz
    from xyz
  )
  select array[116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)] from f;
$$;

-- ── 2. Stored Lab coordinates, kept current by triggers ─────────────────
alter table public.mosaic_pixels
  add column if not exists lab_l real,
  add column if not exists lab_a real,
  add column if not exists lab_b real;
alter table public.mosaic_submissions
  add column if not exists lab_l real,
  add column if not exists lab_a real,
  add column if not exists lab_b real;

create or replace function public.mosaic_pixels_set_lab()
returns trigger
language plpgsql
as $$
declare v double precision[];
begin
  v := public.rgb_to_lab(new.target_r, new.target_g, new.target_b);
  new.lab_l := v[1]; new.lab_a := v[2]; new.lab_b := v[3];
  return new;
end;
$$;
drop trigger if exists mosaic_pixels_set_lab on public.mosaic_pixels;
create trigger mosaic_pixels_set_lab
  before insert or update of target_r, target_g, target_b on public.mosaic_pixels
  for each row execute function public.mosaic_pixels_set_lab();

create or replace function public.mosaic_submissions_set_lab()
returns trigger
language plpgsql
as $$
declare v double precision[];
begin
  v := public.rgb_to_lab(new.avg_r, new.avg_g, new.avg_b);
  new.lab_l := v[1]; new.lab_a := v[2]; new.lab_b := v[3];
  return new;
end;
$$;
drop trigger if exists mosaic_submissions_set_lab on public.mosaic_submissions;
create trigger mosaic_submissions_set_lab
  before insert or update of avg_r, avg_g, avg_b on public.mosaic_submissions
  for each row execute function public.mosaic_submissions_set_lab();

-- Backfill existing rows (idempotent: only rows still missing Lab values).
update public.mosaic_pixels set target_r = target_r where lab_l is null;
update public.mosaic_submissions set avg_r = avg_r where lab_l is null;

-- ── 3. match_pool_artworks: place every pooled piece, entirely in the DB ──
-- Greedy, oldest upload first, closest open cell across every non-archived
-- campaign, skipped when the best fit is farther than 30 (Lab, lightness
-- weighted 0.2) — exactly the client algorithm it replaces. Serialized
-- against itself and commit_pool_matches() by the same advisory lock.
-- Returns [{"submission_id":…,"pixel_id":…}, …] for what it placed.
create or replace function public.match_pool_artworks()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s record;
  v_pixel_id bigint;
  v_project_id bigint;
  v_dist_sq double precision;
  v_updated integer;
  v_placed jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'must be signed in to run artwork matching';
  end if;
  perform pg_advisory_xact_lock(hashtext('commit_pool_matches'));

  for s in
    select id, author_id, lab_l, lab_a, lab_b
    from public.mosaic_submissions
    where project_id is null and pixel_id is null and lab_l is not null
    order by created_at asc
  loop
    v_pixel_id := null;
    select p.id, p.project_id,
           0.2 * (p.lab_l - s.lab_l) ^ 2 + (p.lab_a - s.lab_a) ^ 2 + (p.lab_b - s.lab_b) ^ 2
    into v_pixel_id, v_project_id, v_dist_sq
    from public.mosaic_pixels p
    join public.mosaic_projects pr on pr.id = p.project_id
    where p.filled = false and pr.is_archived = false and p.lab_l is not null
    order by 3 asc
    limit 1;

    if v_pixel_id is null or sqrt(v_dist_sq) > 30 then
      continue; -- no open cell anywhere, or nothing close enough: stays pooled
    end if;

    update public.mosaic_pixels
    set filled = true, submission_id = s.id, claimed_by = s.author_id, claimed_at = now()
    where id = v_pixel_id and filled = false;
    get diagnostics v_updated = row_count;
    if v_updated = 1 then
      update public.mosaic_submissions
      set project_id = v_project_id, pixel_id = v_pixel_id
      where id = s.id;
      v_placed := v_placed || jsonb_build_object('submission_id', s.id, 'pixel_id', v_pixel_id);
    end if;
  end loop;

  return v_placed;
end;
$$;

revoke execute on function public.match_pool_artworks() from public;
grant execute on function public.match_pool_artworks() to authenticated;

-- ── 4. release_poor_matches: server twin of the 6-hourly cleanup ────────
-- Pieces sitting more than 32 (Lab) from their own cell's color go back to
-- the pool so the next match can re-place them. Same sitewide throttle
-- (claim_rematch_slot) and same release path (unmatch_submissions, which
-- keeps its own RGB sanity check) as the client-side version.
create or replace function public.release_poor_matches(p_min_interval interval default interval '6 hours')
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids bigint[];
begin
  if auth.uid() is null then
    raise exception 'must be signed in';
  end if;
  if not public.claim_rematch_slot(p_min_interval) then
    return 0;
  end if;
  select array_agg(s.id) into v_ids
  from public.mosaic_submissions s
  join public.mosaic_pixels p on p.id = s.pixel_id
  join public.mosaic_projects pr on pr.id = p.project_id
  where pr.is_archived = false
    and s.lab_l is not null and p.lab_l is not null
    and sqrt(0.2 * (p.lab_l - s.lab_l) ^ 2 + (p.lab_a - s.lab_a) ^ 2 + (p.lab_b - s.lab_b) ^ 2) > 32;
  if v_ids is null then
    return 0;
  end if;
  return public.unmatch_submissions(v_ids);
end;
$$;

revoke execute on function public.release_poor_matches(interval) from public;
grant execute on function public.release_poor_matches(interval) to authenticated;

-- ── 5. admin_usage_stats: DB / Storage usage for the admin page ─────────
-- Egress (monthly transfer) is a platform metric and is NOT available from
-- inside the database — only the Supabase dashboard has it.
create or replace function public.admin_usage_stats()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then
    raise exception 'admins only';
  end if;
  select jsonb_build_object(
    'db_bytes',      pg_database_size(current_database()),
    'storage_bytes', (select coalesce(sum((metadata->>'size')::bigint), 0) from storage.objects),
    'storage_files', (select count(*) from storage.objects),
    'profiles',      (select count(*) from public.profiles),
    'submissions',   (select count(*) from public.mosaic_submissions),
    'pooled',        (select count(*) from public.mosaic_submissions where project_id is null),
    'pixels',        (select count(*) from public.mosaic_pixels),
    'projects',      (select count(*) from public.mosaic_projects where not is_archived),
    'open_reports',  (select count(*) from public.reports where status = 'open')
  ) into v;
  return v;
end;
$$;

revoke execute on function public.admin_usage_stats() from public;
grant execute on function public.admin_usage_stats() to authenticated; -- gated to admins inside
