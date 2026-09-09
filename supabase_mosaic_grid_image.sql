-- Run this once in the Supabase SQL editor (Project → SQL Editor → New query).
-- Run AFTER supabase_mosaic_profile_pool.sql (this file REPLACES its
-- reshape_mosaic_project() with a version that also carries the grid image).
--
-- Static "reference grid" image per project version (2026-09-10).
-- Every page that draws a campaign used to pull every mosaic_pixels row
-- (x, y, target color) from the database — 0.7 MB / 16 requests for a
-- 4,988-cell campaign, and ~5 MB for a 30,000-cell one, on every view. The
-- target colors never change between reshapes, so the client now also
-- renders them into a width×height PNG (one pixel per cell, transparent
-- where the reference image had no cell) and uploads it to Storage; pages
-- read that image through the /img/ edge cache and only ask the database
-- for the FILLED cells. The pixel rows stay the source of truth for claims;
-- the image is a cache of their colors. A missing/broken image simply makes
-- the client fall back to the row query (js/common.js loadProjectCells).
--
-- Consistency rule: the image URL is written in the same transaction as the
-- grid it depicts — on create (row insert) and on reshape (this RPC), which
-- also hands the previous image to the archived copy of the old grid.
-- Uploads are never overwritten (timestamped paths), so the 1-year /img/
-- cache can't serve a stale grid.

alter table public.mosaic_projects
  add column if not exists grid_image_url text;

-- The 6-argument overload must go: PostgREST can't pick between it and the
-- new one (whose last argument has a default) for a 6-argument call.
drop function if exists public.reshape_mosaic_project(bigint, smallint, smallint, text, jsonb, jsonb);

create or replace function public.reshape_mosaic_project(
  p_project_id bigint,
  p_new_width smallint,
  p_new_height smallint,
  p_new_reference_url text,
  p_cells jsonb,
  p_assignments jsonb,
  p_grid_image_url text default null
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

  -- Freeze the pre-reshape state as its own read-only project — including
  -- the grid image that depicts the old grid, which moves with it.
  insert into public.mosaic_projects
    (title, description, width, height, reference_image_url, grid_image_url, created_by,
     is_archived, archived_at, current_project_id, version_number)
  values
    (v_old_project.title, v_old_project.description, v_old_project.width, v_old_project.height,
     v_old_project.reference_image_url, v_old_project.grid_image_url, v_old_project.created_by,
     true, now(), p_project_id, v_old_project.version_number)
  returning id into v_archived_id;

  update public.mosaic_pixels
  set project_id = v_archived_id
  where project_id = p_project_id;

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

  select count(*) into v_assignment_count from jsonb_array_elements(p_assignments);
  select count(*) into v_mapped_count from jsonb_array_elements(v_mapping);
  if v_mapped_count <> v_assignment_count then
    raise exception 'reshape assignment references a cell outside the new grid';
  end if;

  update public.mosaic_submissions s
  set pixel_id = m.new_pixel_id
  from jsonb_to_recordset(v_mapping) as m(submission_id bigint, new_pixel_id bigint)
  where s.id = m.submission_id and s.project_id = p_project_id;

  -- Pieces that didn't fit the new grid go back to the pool.
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

  -- The new grid's image (or null when the client couldn't produce one —
  -- never the old image, which depicts the grid that just got archived).
  update public.mosaic_projects
  set width = p_new_width, height = p_new_height, reference_image_url = p_new_reference_url,
      grid_image_url = p_grid_image_url,
      version_number = v_old_project.version_number + 1
  where id = p_project_id;
end;
$$;

revoke execute on function public.reshape_mosaic_project(bigint, smallint, smallint, text, jsonb, jsonb, text) from public;
grant execute on function public.reshape_mosaic_project(bigint, smallint, smallint, text, jsonb, jsonb, text) to authenticated;
