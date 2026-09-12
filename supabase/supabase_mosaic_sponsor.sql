-- ⚠ REVERTED ON 2026-09-12 — DO NOT RUN THIS FILE.
-- supabase_mosaic_sponsor_drop.sql removed these columns again and nothing
-- in the site reads or writes them any more (the home hero counts pieces
-- instead of money — CLAUDE.md §7). Running this would put four unused
-- columns back. Kept only as the record of what the feature was.
--
-- Run this once in the Supabase SQL editor (after supabase_mosaic.sql; independent of the other 2026-09 files). Safe to re-run.
--
-- Donation pledge per campaign (2026-09-10): the pledging partner's name,
-- logo and tagline, and the pledged amount in KRW (default ₩500,000).
-- The landing hero shows the partner's logo + name where the fixed
-- "Pledging partner" label used to be, the tagline on the line under it,
-- and the amount in the donation card and the body copy (js/landing.js).
-- Admins fill the fields when creating a campaign (/campaigns → New
-- campaign, js/home.js) or later on /admin → Edit (js/admin.js).
--
-- Until this file is applied the pages fall back to the defaults (label
-- only, ₩500,000) and the admin forms warn that the pledge fields were not
-- saved (the rest of the form still saves).
--
-- No new policies: "Mosaic projects are viewable by everyone" (select) and
-- "Admins can insert/update mosaic projects" (supabase_mosaic.sql) already
-- cover these columns. The logo is uploaded like the reference image — into
-- the admin's own folder of the `artwork` bucket (common.js uploadImage) —
-- so no Storage policy changes either.

alter table public.mosaic_projects add column if not exists sponsor_name     text;
alter table public.mosaic_projects add column if not exists sponsor_logo_url text;
alter table public.mosaic_projects add column if not exists sponsor_tagline  text;
alter table public.mosaic_projects add column if not exists pledge_amount    integer not null default 500000;

-- Length / range guards. Dropped and re-added so the file stays re-runnable.
alter table public.mosaic_projects drop constraint if exists mosaic_projects_sponsor_name_len;
alter table public.mosaic_projects add constraint mosaic_projects_sponsor_name_len
  check (sponsor_name is null or char_length(sponsor_name) <= 80);
alter table public.mosaic_projects drop constraint if exists mosaic_projects_sponsor_tagline_len;
alter table public.mosaic_projects add constraint mosaic_projects_sponsor_tagline_len
  check (sponsor_tagline is null or char_length(sponsor_tagline) <= 200);
alter table public.mosaic_projects drop constraint if exists mosaic_projects_sponsor_logo_url_len;
alter table public.mosaic_projects add constraint mosaic_projects_sponsor_logo_url_len
  check (sponsor_logo_url is null or char_length(sponsor_logo_url) <= 500);
alter table public.mosaic_projects drop constraint if exists mosaic_projects_pledge_amount_range;
alter table public.mosaic_projects add constraint mosaic_projects_pledge_amount_range
  check (pledge_amount between 0 and 1000000000);

-- PostgREST caches the schema; reloading makes the new columns usable at once
-- instead of after its next periodic refresh.
notify pgrst, 'reload schema';
