-- Run this once in the Supabase SQL editor (Project → SQL Editor → New query).
-- Run AFTER supabase_mosaic.sql, BEFORE (re-running) supabase_mosaic_reshape.sql
-- and supabase_mosaic_stats.sql — both are patched by this file's changes
-- and need to be re-run afterward to pick them up.
--
-- Mosaic project version history. reshape_mosaic_project() used to replace
-- a project's grid and reference image in place, deleting the old pixel
-- rows — so every past contributor's profile card for that project would
-- silently flip to whatever the project looks like *today*, even though
-- their piece was part of an earlier, now-gone arrangement.
--
-- This makes a reshape instead leave behind a real archived copy of the
-- project: its own row in mosaic_projects (is_archived = true), handed the
-- *actual* old mosaic_pixels grid (moved, not copied or summarized). It's
-- a genuine project, just frozen — browsable in weavo.html exactly like
-- any other, tile for tile, the way it looked right before the reshape.

alter table public.mosaic_projects
  add column if not exists is_archived        boolean not null default false,
  add column if not exists archived_at        timestamptz,
  add column if not exists current_project_id bigint references public.mosaic_projects(id) on delete cascade,
  add column if not exists version_number     int not null default 1;

create index if not exists mosaic_projects_current_project_id_idx
  on public.mosaic_projects (current_project_id)
  where current_project_id is not null;

-- ── Keep archived projects genuinely frozen ─────────────────────────────

-- Admins can no longer edit an archived project's row directly (reshaping
-- one is disallowed by the function itself — see supabase_mosaic_reshape.sql).
drop policy if exists "Admins can update mosaic projects" on public.mosaic_projects;
create policy "Admins can update mosaic projects"
  on public.mosaic_projects for update
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
         and not is_archived)
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
              and not is_archived);

-- Nobody — not even the pixel's own claimant — can claim/fill/attach on a
-- pixel that belongs to an archived project. Reshaping moves the old grid
-- into the archived copy specifically so it stops being live play surface.
drop policy if exists "Signed-in users can claim and fill mosaic pixels" on public.mosaic_pixels;
create policy "Signed-in users can claim and fill mosaic pixels"
  on public.mosaic_pixels for update
  using (
    (
      filled = false
      or (filled = true and submission_id is null
          and (claimed_by = auth.uid() or claimed_at < now() - interval '10 minutes'))
    )
    and not exists (
      select 1 from public.mosaic_projects mp
      where mp.id = mosaic_pixels.project_id and mp.is_archived
    )
  )
  with check (
    (filled = true and claimed_by = auth.uid() and submission_id is null)
    or (filled = true and claimed_by = auth.uid()
        and exists (
          select 1 from public.mosaic_submissions s
          where s.id = submission_id and s.pixel_id = mosaic_pixels.id and s.author_id = auth.uid()
        ))
    or (filled = false and submission_id is null and claimed_by is null)
  );

-- Same freeze for the broader admin-management update policy (used by the
-- moderation "delete submission → reopen its pixel" flow).
drop policy if exists "Admins can manage mosaic pixels" on public.mosaic_pixels;
create policy "Admins can manage mosaic pixels"
  on public.mosaic_pixels for update
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
    and not exists (
      select 1 from public.mosaic_projects mp
      where mp.id = mosaic_pixels.project_id and mp.is_archived
    )
  )
  with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
    and not exists (
      select 1 from public.mosaic_projects mp
      where mp.id = mosaic_pixels.project_id and mp.is_archived
    )
  );
