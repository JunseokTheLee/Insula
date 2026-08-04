-- Run this once in the Supabase SQL editor (Project → SQL Editor → New query).
-- Run AFTER supabase_mosaic_profile_pool.sql.
--
-- Two more optional details an artist can attach to an upload alongside
-- title/description/link (js/profile-view.js's upload form, shown in the
-- lightbox via js/lightbox.js): the material/medium the piece was made
-- with, and the date it was completed.

alter table public.mosaic_submissions add column if not exists art_material text;
alter table public.mosaic_submissions add column if not exists art_completed_date date;

alter table public.mosaic_submissions
  drop constraint if exists mosaic_submissions_art_material_len;
alter table public.mosaic_submissions
  add constraint mosaic_submissions_art_material_len check (char_length(art_material) <= 100);

alter table public.mosaic_submissions
  drop constraint if exists mosaic_submissions_art_completed_date_range;
alter table public.mosaic_submissions
  add constraint mosaic_submissions_art_completed_date_range check (art_completed_date <= current_date);

-- Column-level insert privilege is additive (see supabase_mosaic_profile_pool.sql's
-- own grant) — this just adds the two new columns to what was already granted.
grant insert (art_material, art_completed_date) on public.mosaic_submissions to authenticated;
