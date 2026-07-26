-- Run this once in the Supabase SQL editor (Project → SQL Editor → New query).
-- Run/re-run AFTER supabase_mosaic_versions.sql (needs mosaic_projects.is_archived).
-- Site-wide aggregate counts for the weavo.html landing hero's stats strip
-- (participating artists, artworks submitted, active projects, overall fill
-- rate). A single-row view is cheap for the client to read and keeps the
-- aggregation server-side instead of pulling full tables down just to count
-- them.
--
-- project_count/fill_percent exclude archived projects (reshape leaves the
-- pre-reshape grid behind, frozen, under its own archived project row —
-- see supabase_mosaic_versions.sql/supabase_mosaic_reshape.sql) — otherwise
-- every reshape would inflate "active projects" and permanently-filled old
-- grids would skew the fill rate upward over time.

create or replace view public.mosaic_stats as
select
  (select count(distinct author_id) from public.mosaic_submissions) as artist_count,
  (select count(*) from public.mosaic_submissions)                   as artwork_count,
  (select count(*) from public.mosaic_projects where not is_archived) as project_count,
  (select coalesce(round(100.0 * count(*) filter (where px.filled) / nullif(count(*), 0)), 0)
     from public.mosaic_pixels px
     join public.mosaic_projects p on p.id = px.project_id
     where not p.is_archived)                                       as fill_percent;

grant select on public.mosaic_stats to anon, authenticated;
