-- Run this once in the Supabase SQL editor (Project → SQL Editor → New query).
-- Run AFTER supabase_mosaic_versions.sql (this function relies on the
-- is_archived/current_project_id/version_number columns it adds).
-- Admin "reshape" feature (weavo.html): lets an admin swap a project's
-- reference image and grid dimensions after submissions already exist,
-- automatically redistributing every already-placed piece of art onto the
-- closest-matching cell of the new grid instead of losing it.
--
-- Before laying down the new grid, the pre-reshape project state is frozen
-- as its own archived project row (is_archived = true, pointing back at
-- this one via current_project_id) and handed the *actual* old
-- mosaic_pixels rows — moved over via a plain UPDATE, not copied. That's
-- what lets a contributor's profile keep showing (and let them browse) the
-- mosaic exactly as it looked when their piece was part of it, even after
-- an admin reshapes it into something new. Moving the old pixels out from
-- under p_project_id first also means the fresh grid below can reuse the
-- same (x,y) coordinate space with no unique-constraint collision — no
-- deferred-constraint juggling needed.
--
-- p_cells: the full new grid, e.g. [{"x":0,"y":0,"r":12,"g":34,"b":56}, ...]
-- (mirrors imageToColorGrid()'s output in weavo.html — one entry per
-- non-transparent cell of the newly uploaded reference image).
-- p_assignments: which existing submissions land on which new cell, e.g.
-- [{"submission_id":1,"x":2,"y":3}, ...] — computed client-side by greedily
-- matching each submission's stored average color to the closest cell in
-- p_cells, same distance metric the live claim flow already uses.
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
