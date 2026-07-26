-- Run this once in the Supabase SQL editor (Project → SQL Editor → New query).
-- Run AFTER supabase_mosaic_comments.sql (this function writes author_avatar_url,
-- which that file adds to mosaic_submissions).
--
-- Changes the "add artwork" flow (weavo.html) from "claim whichever open
-- cell is closest to my color" to "recompute the best-fit placement for
-- EVERY piece in the project (existing + the new one) and lay the whole
-- mosaic down again." The client computes the candidate assignment (greedy
-- nearest-color + a local-search swap pass — same distance metric as
-- everywhere else) and hands it to this function, which does the actual
-- writes atomically so the mosaic is never left half-rearranged.
--
-- p_assignments: where every already-existing submission should land, e.g.
-- [{"submission_id":1,"pixel_id":77}, ...]. p_new_pixel_id is the cell the
-- brand-new submission (created inside this function) lands on.

-- The bulk UPDATE below can legitimately swap two submissions' pixel_id
-- values within a single statement (piece A moving to piece B's old cell
-- and vice versa) — Postgres checks a plain, non-deferrable unique index
-- row-by-row as the statement executes, so that swap would trip a false
-- "duplicate key" error even though the final state is perfectly valid.
-- Converting it to a deferrable constraint defers the uniqueness check to
-- transaction commit, once every row has its final value.
drop index if exists public.mosaic_submissions_pixel_id_key;
alter table public.mosaic_submissions
  drop constraint if exists mosaic_submissions_pixel_id_key;
alter table public.mosaic_submissions
  add constraint mosaic_submissions_pixel_id_key unique (pixel_id) deferrable initially deferred;

create or replace function public.submit_mosaic_artwork_rearranged(
  p_project_id bigint,
  p_image_url text,
  p_avg_r smallint,
  p_avg_g smallint,
  p_avg_b smallint,
  p_art_title text,
  p_art_description text,
  p_art_link text,
  p_author_name text,
  p_author_avatar_url text,
  p_new_pixel_id bigint,
  p_assignments jsonb
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project public.mosaic_projects%rowtype;
  v_author_id uuid := auth.uid();
  v_current_count int;
  v_passed_count int;
  v_new_submission_id bigint;
begin
  if v_author_id is null then
    raise exception 'must be signed in to submit artwork';
  end if;

  -- Serializes concurrent uploads to the same project — without this, two
  -- submissions landing at once could each compute a rearrangement against
  -- the same stale snapshot and stomp on each other.
  perform pg_advisory_xact_lock(p_project_id);

  select * into v_project from public.mosaic_projects where id = p_project_id;
  if not found then
    raise exception 'project % not found', p_project_id;
  end if;
  if v_project.is_archived then
    raise exception 'cannot submit to an archived mosaic project';
  end if;

  -- Staleness guard: p_assignments was computed client-side against a
  -- snapshot of every existing submission in this project. If that set has
  -- changed since (another upload landed first), reject so the client
  -- refetches and recomputes rather than silently stranding a piece or
  -- double-booking a cell.
  select count(*) into v_current_count from public.mosaic_submissions where project_id = p_project_id;
  select coalesce(jsonb_array_length(p_assignments), 0) into v_passed_count;
  if v_current_count <> v_passed_count then
    raise exception 'mosaic changed since rearrangement was computed — retry' using errcode = '40001';
  end if;

  if exists (
    select 1 from jsonb_to_recordset(p_assignments) as a(submission_id bigint, pixel_id bigint)
    left join public.mosaic_submissions s on s.id = a.submission_id and s.project_id = p_project_id
    where s.id is null
  ) then
    raise exception 'mosaic changed since rearrangement was computed — retry' using errcode = '40001';
  end if;

  if not exists (select 1 from public.mosaic_pixels where id = p_new_pixel_id and project_id = p_project_id) then
    raise exception 'target cell does not belong to this project';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_assignments) as a(submission_id bigint, pixel_id bigint)
    left join public.mosaic_pixels px on px.id = a.pixel_id and px.project_id = p_project_id
    where px.id is null
  ) then
    raise exception 'rearrangement references a cell outside this project';
  end if;

  -- Every target cell (existing pieces' new homes + the new piece's home)
  -- must be distinct — guards against a client-computed assignment that
  -- accidentally doubles up two pieces on one cell.
  if (
    select count(distinct pixel_id) from (
      select pixel_id from jsonb_to_recordset(p_assignments) as a(submission_id bigint, pixel_id bigint)
      union all
      select p_new_pixel_id
    ) all_pixels
  ) <> v_passed_count + 1 then
    raise exception 'rearrangement assigns two pieces to the same cell';
  end if;

  insert into public.mosaic_submissions
    (project_id, pixel_id, author_id, author_name, author_avatar_url, image_url,
     avg_r, avg_g, avg_b, art_title, art_description, art_link)
  values
    (p_project_id, p_new_pixel_id, v_author_id, coalesce(p_author_name, 'Anonymous'), p_author_avatar_url, p_image_url,
     p_avg_r, p_avg_g, p_avg_b, p_art_title, p_art_description, p_art_link)
  returning id into v_new_submission_id;

  update public.mosaic_submissions s
  set pixel_id = a.pixel_id
  from jsonb_to_recordset(p_assignments) as a(submission_id bigint, pixel_id bigint)
  where s.id = a.submission_id;

  -- Every piece just got a (possibly unchanged) pixel_id above — recompute
  -- the whole grid's fill state from that rather than patching individual
  -- cells, since a full rearrange can touch any number of them at once.
  update public.mosaic_pixels
  set filled = false, submission_id = null, claimed_by = null, claimed_at = null
  where project_id = p_project_id;

  update public.mosaic_pixels px
  set filled = true, submission_id = s.id, claimed_by = s.author_id, claimed_at = now()
  from public.mosaic_submissions s
  where s.project_id = p_project_id and s.pixel_id = px.id;

  return v_new_submission_id;
end;
$$;

revoke execute on function public.submit_mosaic_artwork_rearranged(
  bigint, text, smallint, smallint, smallint, text, text, text, text, text, bigint, jsonb
) from public;
grant execute on function public.submit_mosaic_artwork_rearranged(
  bigint, text, smallint, smallint, smallint, text, text, text, text, text, bigint, jsonb
) to authenticated;
