-- Run this once in the Supabase SQL editor (Project → SQL Editor → New query).
-- Run AFTER supabase_mosaic_grid_image.sql, supabase_mosaic_profile_pool.sql,
-- supabase_mosaic_project_delete.sql and supabase_game.sql.
-- Re-running is safe: part 1 replaces the function again, part 2 finds
-- nothing left to delete.
--
-- No more archived campaign iterations (2026-10-03, user decision).
--
-- Every admin "reshape" (new size / new reference image) used to freeze the
-- previous grid as a read-only archived campaign row (is_archived = true,
-- current_project_id → the live one) holding the old mosaic_pixels, so a
-- contributor could look back at the mosaic as it was. Since 2026-10-01 no
-- page lists them (the profile's "campaigns" strip hides them too); they
-- were reachable only by an old link or the admin list. On 2026-10-03 the
-- live database held five of them (#16–#20, all of campaign #15, 20,776
-- cells), none referenced by any artwork, piece, game record or star.
--
-- 1. reshape_mosaic_project(): the same function minus the archive — the old
--    grid's cells are deleted instead of moved. Artworks are untouched: the
--    pieces that fit are re-pointed at the new grid exactly as before, the
--    rest go back to the pool exactly as before (pixel_id's FK is ON DELETE
--    SET NULL — supabase_mosaic_project_delete.sql — so deleting the old
--    cells never deletes an artwork).
-- 2. Delete the existing archived rows (their cells go with them by
--    cascade). Guarded: it stops, deleting nothing, if any artwork, game
--    session or game record still points at one of them.
--
-- NOT REVERSIBLE for part 2 — the archived snapshots are gone for good.
-- The columns (is_archived, current_project_id, version_number) stay; the
-- site's existing "not archived" filters keep working and simply match
-- every campaign. The old grid image files stay in Storage (unreferenced).

-- ── 1. reshape without an archive ───────────────────────────────────────
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

  -- The old grid goes. Artworks pointing at its cells get pixel_id = null
  -- (FK on delete set null); the ones that fit are re-pointed just below.
  delete from public.mosaic_pixels where project_id = p_project_id;

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

  update public.mosaic_projects
  set width = p_new_width, height = p_new_height, reference_image_url = p_new_reference_url,
      grid_image_url = p_grid_image_url,
      version_number = v_old_project.version_number + 1
  where id = p_project_id;
end;
$$;

revoke execute on function public.reshape_mosaic_project(bigint, smallint, smallint, text, jsonb, jsonb, text) from public;
grant execute on function public.reshape_mosaic_project(bigint, smallint, smallint, text, jsonb, jsonb, text) to authenticated;

-- ── 2. delete the existing archives (guarded) ───────────────────────────
do $$
declare
  v_ids bigint[];
  v_refs bigint;
begin
  select coalesce(array_agg(id), '{}') into v_ids from public.mosaic_projects where is_archived;
  if cardinality(v_ids) = 0 then
    raise notice 'no archived campaigns — nothing to delete';
    return;
  end if;

  -- Anything that must survive and would be cascaded or orphaned: stop.
  select
    (select count(*) from public.mosaic_submissions where project_id = any(v_ids))
  + (select count(*) from public.mosaic_submissions where home_project_id = any(v_ids))
  + (select count(*) from public.mosaic_submissions s join public.mosaic_pixels p on p.id = s.pixel_id where p.project_id = any(v_ids))
  + (select count(*) from public.game_sessions where project_id = any(v_ids))
  + (select count(*) from public.game_best_records where project_id = any(v_ids))
  into v_refs;
  if v_refs > 0 then
    raise exception 'archived campaigns % are still referenced (% rows) — nothing deleted', v_ids, v_refs;
  end if;

  delete from public.mosaic_projects where id = any(v_ids);   -- their cells go by cascade
  raise notice 'deleted archived campaigns %', v_ids;
end;
$$;
