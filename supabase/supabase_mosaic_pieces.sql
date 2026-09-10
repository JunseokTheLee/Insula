-- Run this once in the Supabase SQL editor (Project → SQL Editor → New query).
-- Run AFTER supabase_mosaic_server_matching.sql, supabase_mosaic_project_delete.sql,
-- supabase_mosaic_profile_pool.sql, supabase_mosaic_submissions_rate_limit.sql,
-- supabase_mosaic_stats.sql and supabase_site_settings.sql — it redefines
-- functions from the first five and reads the options table. Safe to re-run.
--
-- Artwork pieces (2026-09-10). An artwork no longer fills ONE mosaic cell as
-- a whole: it is cut into n×n pieces in the browser (n = the pieceGrid site
-- option, default 7 → 49 pieces) and each PIECE is matched to a cell by its
-- own colour. One artwork therefore contributes many cells — or none, when no
-- open cell is close enough (pieceMatchDistance option, default 20 in
-- lightness-weighted Lab; the old whole-artwork rule was 30).
--
-- Pieces are rows of mosaic_submissions of their own (parent_id → the
-- artwork), because every placement mechanism already works per row:
-- matching, poor-match release, the pool, reshape, campaign deletion, the
-- "delete resets the cell" trigger. The artwork row itself is never placed
-- again (piece_n marks it as cut); it keeps title, description, likes and
-- comments. Artwork LISTS must leave pieces out (parent_id is null) — the
-- pages do, and the stats below do.
--
-- Campaign lock: an artwork belongs to ONE campaign (home_project_id) — the
-- newest active campaign when its pieces are first cut — and its pieces are
-- matched into that campaign only. When that campaign is deleted the artwork
-- moves to the newest remaining one (delete_mosaic_project); when none exists
-- yet, the next matching pass assigns one.
--
-- Contribution / pledge maths need no change: they count cells, and a cell
-- now holds a piece row carrying the artist's author_id.

-- ── 1. columns, constraints, indexes ─────────────────────────────────────
alter table public.mosaic_submissions add column if not exists parent_id       bigint references public.mosaic_submissions(id) on delete cascade;
alter table public.mosaic_submissions add column if not exists piece_row       smallint;
alter table public.mosaic_submissions add column if not exists piece_col       smallint;
alter table public.mosaic_submissions add column if not exists piece_n         smallint;
-- Deliberately no FK: delete_mosaic_project reassigns it, and a second FK to
-- mosaic_projects would make PostgREST's mosaic_projects(...) embed ambiguous.
alter table public.mosaic_submissions add column if not exists home_project_id bigint;
alter table public.mosaic_submissions add column if not exists match_tried_at  timestamptz;

alter table public.mosaic_submissions drop constraint if exists mosaic_submissions_piece_shape;
alter table public.mosaic_submissions add constraint mosaic_submissions_piece_shape check (
  (parent_id is null and piece_row is null and piece_col is null)
  or (parent_id is not null and piece_n between 2 and 12
      and piece_row between 0 and piece_n - 1 and piece_col between 0 and piece_n - 1)
);
alter table public.mosaic_submissions drop constraint if exists mosaic_submissions_piece_n_range;
alter table public.mosaic_submissions add constraint mosaic_submissions_piece_n_range
  check (piece_n is null or piece_n between 2 and 12);

create index if not exists mosaic_submissions_parent_id_idx
  on public.mosaic_submissions (parent_id) where parent_id is not null;
create unique index if not exists mosaic_submissions_piece_pos_key
  on public.mosaic_submissions (parent_id, piece_row, piece_col) where parent_id is not null;
-- Artwork listings (parent_id is null) newest first.
create index if not exists mosaic_submissions_artworks_idx
  on public.mosaic_submissions (created_at desc, id desc) where parent_id is null;
-- The pool of pieces waiting for a cell, in the order a matching pass takes them.
create index if not exists mosaic_submissions_pool_pieces_idx
  on public.mosaic_submissions (match_tried_at, created_at) where parent_id is not null and pixel_id is null;

-- When did a campaign last get an OPEN cell (created, reshaped, a piece
-- released)? A pooled piece is only re-tried against a campaign that changed
-- since its last try, so an event pass costs the new pieces, not the whole
-- pool every time.
alter table public.mosaic_projects add column if not exists cells_changed_at timestamptz not null default now();

create or replace function public.mosaic_pixels_note_open_cells()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.mosaic_projects
  set cells_changed_at = now()
  where id in (select distinct project_id from changed_rows where not filled);
  return null;
end;
$$;
-- One trigger per event: Postgres refuses a transition table on a trigger
-- that names more than one event ("transition tables cannot be specified
-- for triggers with more than one event", 0A000).
drop trigger if exists mosaic_pixels_note_open_cells on public.mosaic_pixels;
drop trigger if exists mosaic_pixels_note_open_cells_ins on public.mosaic_pixels;
drop trigger if exists mosaic_pixels_note_open_cells_upd on public.mosaic_pixels;
create trigger mosaic_pixels_note_open_cells_ins
  after insert on public.mosaic_pixels
  referencing new table as changed_rows
  for each statement execute function public.mosaic_pixels_note_open_cells();
create trigger mosaic_pixels_note_open_cells_upd
  after update on public.mosaic_pixels
  referencing new table as changed_rows
  for each statement execute function public.mosaic_pixels_note_open_cells();

-- ── 2. the colour-match threshold is a site option (admin page) ──────────
create or replace function public.piece_match_distance()
returns double precision
language sql
stable
set search_path = public
as $$
  select least(60, greatest(5, coalesce(
    (select (settings->>'pieceMatchDistance')::double precision from public.site_settings where id = true),
    20)));
$$;

-- ── 3. rate limit: pieces are not uploads ─────────────────────────────────
-- 49 piece rows arrive with every upload; only the artwork rows count.
create or replace function public.enforce_mosaic_submission_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window     constant interval := interval '10 minutes';
  v_max_uploads constant int := 20;
  v_recent_count int;
begin
  if new.parent_id is not null then
    return new;
  end if;

  select count(*) into v_recent_count
  from public.mosaic_submissions
  where author_id = new.author_id
    and parent_id is null
    and created_at > now() - v_window;

  if v_recent_count >= v_max_uploads then
    raise exception 'upload rate limit exceeded — please wait a few minutes and try again'
      using errcode = 'RATE1';
  end if;

  return new;
end;
$$;

-- ── 4. set_submission_pieces: cut (or re-cut) an artwork ─────────────────
-- The browser cuts the image and sends one entry per piece:
--   [{"row":0,"col":0,"r":..,"g":..,"b":..,"micro":"data:image/jpeg;base64,..."}, …]
-- (fully transparent regions of a PNG are simply left out, so there may be
-- fewer than n² entries). The artist or an admin may call it; the row copies
-- author / image / title from the artwork so every reader of a cell sees the
-- artist without a join. Re-cutting deletes the old pieces first — their
-- cells reopen through reset_pixel_on_submission_delete — and an artwork
-- still placed as a WHOLE (from before pieces) gives its cell back too.
create or replace function public.set_submission_pieces(p_parent_id bigint, p_n integer, p_pieces jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parent public.mosaic_submissions%rowtype;
  v_home bigint;
  v_count integer;
begin
  if auth.uid() is null then
    raise exception 'must be signed in to cut artwork into pieces';
  end if;
  select * into v_parent from public.mosaic_submissions where id = p_parent_id for update;
  if not found then
    raise exception 'artwork % not found', p_parent_id;
  end if;
  if v_parent.parent_id is not null then
    raise exception 'a piece cannot be cut into pieces';
  end if;
  if v_parent.author_id <> auth.uid()
     and not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then
    raise exception 'only the artist or an admin can cut this artwork';
  end if;
  if p_n is null or p_n < 2 or p_n > 12 then
    raise exception 'piece grid must be between 2 and 12';
  end if;
  if p_pieces is null or jsonb_typeof(p_pieces) <> 'array' then
    raise exception 'pieces must be a JSON array';
  end if;
  v_count := jsonb_array_length(p_pieces);
  if v_count < 1 or v_count > p_n * p_n then
    raise exception 'piece count % out of range for a %x% cut', v_count, p_n, p_n;
  end if;

  -- Not racing a matching pass over the pieces being replaced.
  perform pg_advisory_xact_lock(hashtext('commit_pool_matches'));

  if v_parent.pixel_id is not null then
    update public.mosaic_pixels
    set filled = false, submission_id = null, claimed_by = null, claimed_at = null
    where id = v_parent.pixel_id;
    update public.mosaic_submissions set project_id = null, pixel_id = null where id = p_parent_id;
  end if;
  delete from public.mosaic_submissions where parent_id = p_parent_id;

  -- Campaign lock: keep the artwork's campaign while it runs, else the newest
  -- active one; null when there is none (the next matching pass assigns one).
  v_home := v_parent.home_project_id;
  if v_home is not null and not exists (select 1 from public.mosaic_projects where id = v_home and not is_archived) then
    v_home := null;
  end if;
  if v_home is null then
    select id into v_home from public.mosaic_projects where not is_archived order by created_at desc limit 1;
  end if;

  insert into public.mosaic_submissions
    (parent_id, piece_row, piece_col, piece_n, home_project_id,
     author_id, author_name, author_avatar_url, image_url, thumb_url, art_title,
     avg_r, avg_g, avg_b, micro_thumb)
  select p_parent_id, (e->>'row')::smallint, (e->>'col')::smallint, p_n, v_home,
         v_parent.author_id, v_parent.author_name, v_parent.author_avatar_url,
         v_parent.image_url, v_parent.thumb_url, v_parent.art_title,
         (e->>'r')::smallint, (e->>'g')::smallint, (e->>'b')::smallint, e->>'micro'
  from jsonb_array_elements(p_pieces) e;

  update public.mosaic_submissions
  set piece_n = p_n, home_project_id = v_home
  where id = p_parent_id;

  return v_count;
end;
$$;

revoke execute on function public.set_submission_pieces(bigint, integer, jsonb) from public;
grant execute on function public.set_submission_pieces(bigint, integer, jsonb) to authenticated;

-- ── 5. matching: pieces only, inside their own campaign, option threshold ─
-- Replaces the whole-artwork pass of supabase_mosaic_server_matching.sql.
-- Each pooled piece takes the closest open cell of ITS campaign, skipped when
-- that is farther than piece_match_distance(). A piece is re-tried only when
-- its campaign gained open cells since its last try (cells_changed_at), and
-- a pass handles at most v_batch pieces — new uploads first — so a pass
-- stays quick however large the pool grows. Returns
-- [{"submission_id":piece,"parent_id":artwork,"pixel_id":cell}, …].
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
  v_max double precision;
  v_home bigint;
  v_batch constant integer := 1500;
begin
  if auth.uid() is null then
    raise exception 'must be signed in to run artwork matching';
  end if;
  perform pg_advisory_xact_lock(hashtext('commit_pool_matches'));
  v_max := public.piece_match_distance();

  for s in
    select sub.id, sub.parent_id, sub.author_id, sub.lab_l, sub.lab_a, sub.lab_b, sub.home_project_id
    from public.mosaic_submissions sub
    left join public.mosaic_projects pr on pr.id = sub.home_project_id and not pr.is_archived
    where sub.parent_id is not null and sub.project_id is null and sub.pixel_id is null and sub.lab_l is not null
      and (sub.match_tried_at is null or pr.id is null or sub.match_tried_at < pr.cells_changed_at)
    order by sub.match_tried_at asc nulls first, sub.created_at asc, sub.id asc
    limit v_batch
  loop
    v_home := s.home_project_id;
    if v_home is null or not exists (select 1 from public.mosaic_projects where id = v_home and not is_archived) then
      -- No campaign yet, or its campaign is gone: the artwork (all its pieces
      -- with it) moves to the newest active campaign.
      select id into v_home from public.mosaic_projects where not is_archived order by created_at desc limit 1;
      if v_home is null then
        exit; -- no campaign at all — nothing to place anywhere
      end if;
      update public.mosaic_submissions set home_project_id = v_home
      where id = s.parent_id or parent_id = s.parent_id;
    end if;

    v_pixel_id := null;
    select p.id, p.project_id,
           0.2 * (p.lab_l - s.lab_l) ^ 2 + (p.lab_a - s.lab_a) ^ 2 + (p.lab_b - s.lab_b) ^ 2
    into v_pixel_id, v_project_id, v_dist_sq
    from public.mosaic_pixels p
    where p.project_id = v_home and p.filled = false and p.lab_l is not null
    order by 3 asc
    limit 1;

    update public.mosaic_submissions set match_tried_at = now() where id = s.id;
    if v_pixel_id is null or sqrt(v_dist_sq) > v_max then
      continue; -- no open cell, or nothing close enough: stays pooled
    end if;

    update public.mosaic_pixels
    set filled = true, submission_id = s.id, claimed_by = s.author_id, claimed_at = now()
    where id = v_pixel_id and filled = false;
    get diagnostics v_updated = row_count;
    if v_updated = 1 then
      update public.mosaic_submissions
      set project_id = v_project_id, pixel_id = v_pixel_id
      where id = s.id;
      v_placed := v_placed || jsonb_build_object('submission_id', s.id, 'parent_id', s.parent_id, 'pixel_id', v_pixel_id);
    end if;
  end loop;

  return v_placed;
end;
$$;

revoke execute on function public.match_pool_artworks() from public;
grant execute on function public.match_pool_artworks() to authenticated;

-- ── 6. poor-match release: option + 2, pieces only ───────────────────────
-- Whole artworks still sitting in cells from before pieces are left alone
-- (they would never be re-placed); the admin page's "cut pieces" replaces them.
create or replace function public.release_poor_matches(p_min_interval interval default interval '6 hours')
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids bigint[];
  v_max double precision;
begin
  if auth.uid() is null then
    raise exception 'must be signed in';
  end if;
  if not public.claim_rematch_slot(p_min_interval) then
    return 0;
  end if;
  v_max := public.piece_match_distance() + 2;
  select array_agg(s.id) into v_ids
  from public.mosaic_submissions s
  join public.mosaic_pixels p on p.id = s.pixel_id
  join public.mosaic_projects pr on pr.id = p.project_id
  where pr.is_archived = false
    and s.parent_id is not null
    and s.lab_l is not null and p.lab_l is not null
    and sqrt(0.2 * (p.lab_l - s.lab_l) ^ 2 + (p.lab_a - s.lab_a) ^ 2 + (p.lab_b - s.lab_b) ^ 2) > v_max;
  if v_ids is null then
    return 0;
  end if;
  return public.unmatch_submissions(v_ids);
end;
$$;

revoke execute on function public.release_poor_matches(interval) from public;
grant execute on function public.release_poor_matches(interval) to authenticated;

-- ── 7. unmatch_submission: an artwork id releases all of its pieces ───────
create or replace function public.unmatch_submission(p_submission_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_submission public.mosaic_submissions%rowtype;
begin
  if auth.uid() is null then
    raise exception 'must be signed in to remove artwork from a project';
  end if;

  select * into v_submission from public.mosaic_submissions where id = p_submission_id;
  if not found then
    raise exception 'submission % not found', p_submission_id;
  end if;

  if v_submission.author_id <> auth.uid()
     and not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then
    raise exception 'only the artist or an admin can remove this piece from its project';
  end if;

  if v_submission.parent_id is null and v_submission.piece_n is not null then
    -- A cut artwork: every placed piece goes back to the pool.
    update public.mosaic_pixels
    set filled = false, submission_id = null, claimed_by = null, claimed_at = null
    where id in (select pixel_id from public.mosaic_submissions where parent_id = p_submission_id and pixel_id is not null);
    update public.mosaic_submissions
    set project_id = null, pixel_id = null
    where parent_id = p_submission_id and pixel_id is not null;
  end if;

  if v_submission.pixel_id is not null then
    update public.mosaic_pixels
    set filled = false, submission_id = null, claimed_by = null, claimed_at = null
    where id = v_submission.pixel_id;
  end if;

  update public.mosaic_submissions
  set project_id = null, pixel_id = null
  where id = p_submission_id;
end;
$$;

revoke execute on function public.unmatch_submission(bigint) from public;
grant execute on function public.unmatch_submission(bigint) to authenticated;

-- ── 8. delete_mosaic_project: artworks locked to it move on ──────────────
create or replace function public.delete_mosaic_project(p_project_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project public.mosaic_projects%rowtype;
  v_next bigint;
begin
  if auth.uid() is null then
    raise exception 'must be signed in to delete a mosaic project';
  end if;
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then
    raise exception 'only admins can delete a mosaic project';
  end if;

  select * into v_project from public.mosaic_projects where id = p_project_id;
  if not found then
    raise exception 'project % not found', p_project_id;
  end if;
  if v_project.is_archived then
    raise exception 'cannot delete an archived mosaic project directly';
  end if;

  -- Release every row placed in this project (or one of its archived
  -- iterations) back to the pool — both columns in one statement, for the
  -- "(project_id is null) = (pixel_id is null)" check.
  update public.mosaic_submissions
  set project_id = null, pixel_id = null
  where project_id = p_project_id
     or project_id in (
       select id from public.mosaic_projects where current_project_id = p_project_id
     );

  -- Artworks locked to this campaign (and their pieces) move to the newest
  -- remaining one; with none left they wait and the next matching pass
  -- assigns whichever campaign appears. match_tried_at is cleared so the
  -- pass after this delete tries them first.
  select id into v_next from public.mosaic_projects
  where not is_archived and id <> p_project_id
  order by created_at desc limit 1;
  update public.mosaic_submissions
  set home_project_id = v_next, match_tried_at = null
  where home_project_id = p_project_id;

  delete from public.mosaic_projects where id = p_project_id;
end;
$$;

revoke execute on function public.delete_mosaic_project(bigint) from public;
grant  execute on function public.delete_mosaic_project(bigint) to authenticated; -- gated to admins inside

-- ── 9. counts: artworks are rows without a parent ────────────────────────
create or replace view public.mosaic_stats as
select
  (select count(*) from public.profiles)                                        as artist_count,
  (select count(*) from public.mosaic_submissions where parent_id is null)       as artwork_count,
  (select count(*) from public.mosaic_projects where not is_archived)            as project_count,
  (select coalesce(round(100.0 * count(*) filter (where px.filled) / nullif(count(*), 0)), 0)
     from public.mosaic_pixels px
     join public.mosaic_projects p on p.id = px.project_id
     where not p.is_archived)                                                   as fill_percent;

grant select on public.mosaic_stats to anon, authenticated;

-- 'submissions' = artworks, 'pooled' = pieces waiting for a cell (what the
-- admin page's usage tile shows as "artworks (pieces waiting)").
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
    'submissions',   (select count(*) from public.mosaic_submissions where parent_id is null),
    'pooled',        (select count(*) from public.mosaic_submissions where parent_id is not null and project_id is null),
    'pixels',        (select count(*) from public.mosaic_pixels),
    'projects',      (select count(*) from public.mosaic_projects where not is_archived),
    'open_reports',  (select count(*) from public.reports where status = 'open')
  ) into v;
  return v;
end;
$$;

revoke execute on function public.admin_usage_stats() from public;
grant execute on function public.admin_usage_stats() to authenticated; -- gated to admins inside

-- PostgREST caches the schema; reload so the new columns / function are
-- usable at once.
notify pgrst, 'reload schema';
