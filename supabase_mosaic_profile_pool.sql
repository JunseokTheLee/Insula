-- Run this once in the Supabase SQL editor (Project → SQL Editor → New query).
-- Run AFTER supabase_mosaic_thumbnails.sql and supabase_mosaic_versions.sql
-- (this file's reshape changes rely on is_archived/current_project_id, and
-- its RPCs reuse the p_thumb_url-era submissions shape).
--
-- Decouples uploading artwork from picking a project. Previously every
-- mosaic_submissions row was born already bound to one project_id/pixel_id
-- (weavo.html's "Upload Art" button lived on the project page). Now:
--   1. Artists upload to their own profile — project_id/pixel_id start null.
--   2. A client-side matcher (js/matching.js's runPoolMatching(), triggered
--      right after uploads, new projects, reshapes, and removals — see that
--      file for why no cron/server process is needed) greedily assigns
--      each unmatched piece to the closest still-open cell across every
--      non-archived project, same Lab-distance metric as everywhere else.
--   3. A piece can occupy at most one cell at a time (still enforced by the
--      pre-existing unique index on pixel_id — Postgres unique indexes
--      already allow any number of NULLs, so nothing changes there), and
--      going back to project_id/pixel_id = null (removed from a project,
--      not deleted outright) returns it to the matchable pool.

-- ── 1. Retire the old direct-to-project upload path ──────────────────────
-- No client code calls this anymore — uploads go through the profile pool
-- (js/profile-view.js) and commit_pool_matches below instead.
drop function if exists public.submit_mosaic_artwork_rearranged(
  bigint, text, text, smallint, smallint, smallint, text, text, text, text, text, bigint, jsonb
);

-- ── 2. Let a submission exist unmatched ────────────────────────────────
alter table public.mosaic_submissions alter column project_id drop not null;
alter table public.mosaic_submissions alter column pixel_id drop not null;

alter table public.mosaic_submissions
  drop constraint if exists mosaic_submissions_match_pairing;
alter table public.mosaic_submissions
  add constraint mosaic_submissions_match_pairing
  check ((project_id is null) = (pixel_id is null));

-- ── 3. RLS: allow a bare profile upload (no project/pixel yet) ───────────
-- The existing "Signed-in users can submit mosaic artwork" policy (still in
-- effect) requires an already-claimed pixel — that's the old direct-claim
-- flow superseded by submit_mosaic_artwork_rearranged, left as-is since it's
-- harmless and unused by any current client code path. This adds the
-- parallel bare-upload path the new profile page uses.
drop policy if exists "Signed-in users can upload artwork to their profile" on public.mosaic_submissions;
create policy "Signed-in users can upload artwork to their profile"
  on public.mosaic_submissions for insert
  with check (
    auth.uid() = author_id
    and project_id is null
    and pixel_id is null
  );

grant insert (author_id, author_name, author_avatar_url, image_url, thumb_url,
              avg_r, avg_g, avg_b, art_title, art_description, art_link)
  on public.mosaic_submissions to authenticated;

-- ── 4. commit_pool_matches: atomically place pool art into open cells ────
-- p_assignments: [{"submission_id":1,"pixel_id":77}, ...] — computed
-- client-side by runPoolMatching() against a snapshot of every unmatched
-- submission and every open cell across all non-archived projects. Re-checks
-- everything server-side before writing, same staleness-guard shape as
-- submit_mosaic_artwork_rearranged, since the snapshot may be stale by the
-- time this runs (another browser's matching pass, or a manual claim,
-- landing first).
create or replace function public.commit_pool_matches(p_assignments jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  if auth.uid() is null then
    raise exception 'must be signed in to run artwork matching';
  end if;

  select coalesce(jsonb_array_length(p_assignments), 0) into v_count;
  if v_count = 0 then
    return;
  end if;

  -- Global (not per-project) lock: this batch can touch cells in any
  -- number of projects at once, so a single fixed key serializes concurrent
  -- matching runs against each other regardless of which projects they span.
  perform pg_advisory_xact_lock(hashtext('commit_pool_matches'));

  -- Every submission in the batch must still be unmatched.
  if exists (
    select 1 from jsonb_to_recordset(p_assignments) as a(submission_id bigint, pixel_id bigint)
    left join public.mosaic_submissions s on s.id = a.submission_id and s.project_id is null
    where s.id is null
  ) then
    raise exception 'pool changed since matching was computed — retry' using errcode = '40001';
  end if;

  -- Every target cell must still be open, and belong to a non-archived project.
  if exists (
    select 1 from jsonb_to_recordset(p_assignments) as a(submission_id bigint, pixel_id bigint)
    left join public.mosaic_pixels px on px.id = a.pixel_id and px.filled = false
    left join public.mosaic_projects pr on pr.id = px.project_id and pr.is_archived = false
    where px.id is null or pr.id is null
  ) then
    raise exception 'pool changed since matching was computed — retry' using errcode = '40001';
  end if;

  -- No two submissions in this batch may target the same cell.
  if (
    select count(distinct pixel_id) from jsonb_to_recordset(p_assignments) as a(submission_id bigint, pixel_id bigint)
  ) <> v_count then
    raise exception 'matching batch assigns two pieces to the same cell';
  end if;

  update public.mosaic_submissions s
  set project_id = px.project_id, pixel_id = a.pixel_id
  from jsonb_to_recordset(p_assignments) as a(submission_id bigint, pixel_id bigint)
  join public.mosaic_pixels px on px.id = a.pixel_id
  where s.id = a.submission_id;

  update public.mosaic_pixels px
  set filled = true, submission_id = s.id, claimed_by = s.author_id, claimed_at = now()
  from jsonb_to_recordset(p_assignments) as a(submission_id bigint, pixel_id bigint)
  join public.mosaic_submissions s on s.id = a.submission_id
  where px.id = a.pixel_id;
end;
$$;

revoke execute on function public.commit_pool_matches(jsonb) from public;
grant execute on function public.commit_pool_matches(jsonb) to authenticated;

-- ── 5. unmatch_submission: pull a piece out of a project, back to the pool ──
-- Used by an admin's "Remove from project" action (js/lightbox.js), and by
-- the reshape flow below when a piece no longer fits the new grid. Distinct
-- from the author's own "Delete" button (js/lightbox.js's
-- deleteWeavoSubmission), which stays a real delete.
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

  -- Explicit auth.uid() is null check above matters here: with it left
  -- out, an unauthenticated caller would make author_id <> auth.uid()
  -- evaluate to NULL, and plpgsql's IF treats a NULL condition as false —
  -- silently skipping this whole guard instead of raising.
  if v_submission.author_id <> auth.uid()
     and not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then
    raise exception 'only the artist or an admin can remove this piece from its project';
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

-- ── 6. reshape_mosaic_project: return non-fitting pieces to the pool ────
-- Previously the client (js/project.js) simply refused to reshape a project
-- down to fewer cells than it had submissions, and this function raised an
-- exception if p_assignments didn't cover every existing submission — so a
-- submission whose id was left out of p_assignments would never actually
-- reach this function in the first place. Now the client is allowed to pass
-- a partial p_assignments (only the pieces that fit the new grid); anything
-- left over gets unmatched here rather than the reshape being blocked or
-- (worse) a leftover piece silently continuing to point at its old,
-- now-archived pixel forever.
create or replace function public.reshape_mosaic_project(
  p_project_id bigint,
  p_new_width smallint,
  p_new_height smallint,
  p_new_reference_url text,
  p_cells jsonb,
  p_assignments jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_grid jsonb;
  v_mapping jsonb;
  v_assignment_count int;
  v_mapped_count int;
  v_old_project public.mosaic_projects%rowtype;
  v_archived_id bigint;
begin
  if not exists (
    select 1 from public.profiles where id = auth.uid() and is_admin
  ) then
    raise exception 'only admins can reshape a mosaic project';
  end if;

  select * into v_old_project from public.mosaic_projects where id = p_project_id;
  if not found then
    raise exception 'project % not found', p_project_id;
  end if;
  if v_old_project.is_archived then
    raise exception 'cannot reshape an archived mosaic project';
  end if;

  if coalesce(jsonb_array_length(p_cells), 0) = 0 then
    raise exception 'new grid has no cells';
  end if;

  -- Freeze the pre-reshape state as its own read-only project.
  insert into public.mosaic_projects
    (title, description, width, height, reference_image_url, created_by,
     is_archived, archived_at, current_project_id, version_number)
  values
    (v_old_project.title, v_old_project.description, v_old_project.width, v_old_project.height,
     v_old_project.reference_image_url, v_old_project.created_by,
     true, now(), p_project_id, v_old_project.version_number)
  returning id into v_archived_id;

  update public.mosaic_pixels
  set project_id = v_archived_id
  where project_id = p_project_id;

  -- Lay down the whole new grid as fresh, unfilled pixel rows, and keep
  -- track of the (x,y) -> new id mapping to use below.
  with ins as (
    insert into public.mosaic_pixels (project_id, x, y, target_r, target_g, target_b)
    select p_project_id, c.x, c.y, c.r, c.g, c.b
    from jsonb_to_recordset(p_cells) as c(x smallint, y smallint, r smallint, g smallint, b smallint)
    returning id, x, y
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'x', x, 'y', y)), '[]'::jsonb)
  into v_new_grid from ins;

  select coalesce(jsonb_agg(jsonb_build_object('submission_id', a.submission_id, 'new_pixel_id', np.id)), '[]'::jsonb)
  into v_mapping
  from jsonb_to_recordset(p_assignments) as a(submission_id bigint, x smallint, y smallint)
  join jsonb_to_recordset(v_new_grid) as np(id bigint, x smallint, y smallint)
    on np.x = a.x and np.y = a.y;

  -- Every incoming assignment must land on a cell that actually exists in
  -- the new grid — otherwise its submission's pixel_id would never get
  -- repointed below, silently stranding that piece on the now-archived old
  -- grid forever instead of taking its place in the live mosaic.
  select count(*) into v_assignment_count from jsonb_array_elements(p_assignments);
  select count(*) into v_mapped_count from jsonb_array_elements(v_mapping);
  if v_mapped_count <> v_assignment_count then
    raise exception 'reshape assignment references a cell outside the new grid';
  end if;

  update public.mosaic_submissions s
  set pixel_id = m.new_pixel_id
  from jsonb_to_recordset(v_mapping) as m(submission_id bigint, new_pixel_id bigint)
  where s.id = m.submission_id and s.project_id = p_project_id;

  -- Anything that belonged to this project but wasn't reassigned above
  -- (the new grid was too small to fit it) goes back to the pool instead of
  -- being left pointing at a pixel that now belongs to the archived copy.
  update public.mosaic_submissions s
  set project_id = null, pixel_id = null
  where s.project_id = p_project_id
    and not exists (
      select 1 from jsonb_to_recordset(v_mapping) as m(submission_id bigint, new_pixel_id bigint)
      where m.submission_id = s.id
    );

  update public.mosaic_pixels px
  set filled = true, submission_id = m.submission_id,
      claimed_by = s.author_id, claimed_at = now()
  from jsonb_to_recordset(v_mapping) as m(submission_id bigint, new_pixel_id bigint)
  join public.mosaic_submissions s on s.id = m.submission_id
  where px.id = m.new_pixel_id;

  update public.mosaic_projects
  set width = p_new_width, height = p_new_height, reference_image_url = p_new_reference_url,
      version_number = v_old_project.version_number + 1
  where id = p_project_id;
end;
$$;

revoke execute on function public.reshape_mosaic_project(bigint, smallint, smallint, text, jsonb, jsonb) from public;
grant execute on function public.reshape_mosaic_project(bigint, smallint, smallint, text, jsonb, jsonb) to authenticated;
