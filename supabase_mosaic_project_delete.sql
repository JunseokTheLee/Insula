-- Run this once in the Supabase SQL editor (Project → SQL Editor → New query).
-- Run AFTER supabase_mosaic_profile_pool.sql and supabase_mosaic_versions.sql
-- (needs the nullable project_id/pixel_id those make optional, and the
-- is_archived / current_project_id columns versions.sql adds).
--
-- Deleting a mosaic project used to take every piece of art submitted to it
-- down with it: mosaic_submissions.project_id and .pixel_id were both
-- "on delete cascade", so removing the project row cascaded straight through
-- into the submissions. That's wrong now that artwork lives in a
-- profile-owned pool and is only *arranged into* projects — think of one
-- bank of every artwork in Weavo, rearranged to fit projects when possible.
-- A project going away should just release its pieces back to that pool
-- (js/matching.js's runPoolMatching() then re-places each one wherever else
-- it fits), exactly like a reshape dropping a piece or an admin removing one.
--
-- This file:
--   1. Repoints those two FKs to "on delete set null" so a stray or manual
--      project delete can never destroy submissions again — at worst it
--      aborts (the project_id/pixel_id pairing check below trips mid-cascade
--      and rolls the whole delete back), never silently deletes artwork.
--   2. Adds delete_mosaic_project(), the supported path: it detaches every
--      submission first (both columns nulled in one statement, so the
--      pairing check stays satisfied), then deletes the project — which
--      still cascades to its mosaic_pixels and, via current_project_id, to
--      any archived iterations and their pixels.

-- ── 1. FKs: release submissions instead of cascading into them ──────────
alter table public.mosaic_submissions
  drop constraint if exists mosaic_submissions_project_id_fkey;
alter table public.mosaic_submissions
  add  constraint mosaic_submissions_project_id_fkey
  foreign key (project_id) references public.mosaic_projects(id) on delete set null;

alter table public.mosaic_submissions
  drop constraint if exists mosaic_submissions_pixel_id_fkey;
alter table public.mosaic_submissions
  add  constraint mosaic_submissions_pixel_id_fkey
  foreign key (pixel_id) references public.mosaic_pixels(id) on delete set null;

-- ── 2. delete_mosaic_project: drop a project, keep its artwork ──────────
create or replace function public.delete_mosaic_project(p_project_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project public.mosaic_projects%rowtype;
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
    -- Archived iterations only ever go away as part of deleting their live
    -- project (current_project_id on delete cascade), never on their own.
    raise exception 'cannot delete an archived mosaic project directly';
  end if;

  -- Release every piece tied to this project (or to one of its archived
  -- iterations) back to the pool. Both columns are nulled in a single
  -- statement so the "(project_id is null) = (pixel_id is null)" check
  -- constraint stays satisfied — it is not deferrable past the delete below.
  update public.mosaic_submissions
  set project_id = null, pixel_id = null
  where project_id = p_project_id
     or project_id in (
       select id from public.mosaic_projects where current_project_id = p_project_id
     );

  -- Cascades to mosaic_pixels (project_id on delete cascade) and to any
  -- archived iterations + their pixels (current_project_id on delete
  -- cascade). No submission references the project or its pixels anymore,
  -- so nothing here touches mosaic_submissions.
  delete from public.mosaic_projects where id = p_project_id;
end;
$$;

revoke execute on function public.delete_mosaic_project(bigint) from public;
grant  execute on function public.delete_mosaic_project(bigint) to authenticated; -- gated to admins inside
