-- Run this once in the Supabase SQL editor (Project → SQL Editor → New query).
-- Reverts supabase_mosaic_sponsor.sql: removes the donation-pledge columns
-- from mosaic_projects (2026-09-12, user instruction).
--
-- WHY: the home hero used to show a pledging partner (logo, name, tagline)
-- and money — "₩458,300 / ₩2,000,000", "my contribution ₩12,000". None of
-- it was a transaction; it described a third party's pledge. It still read
-- as money inside the app, which is what an App Store reviewer asked about
-- (Guideline 2.1, "Can users make any purchase from this app?"). The hero
-- was switched to piece counts on 2026-09-12, and this file removes what is
-- behind it so no screen, form, or column refers to money any more.
--
-- THIS IS NOT REVERSIBLE — dropping a column drops its data. Checked against
-- production before writing this file: one campaign exists ("Side by Side")
-- and its only non-null pledge value is pledge_amount = 200000; no sponsor
-- name, logo or tagline was ever set, so no Storage file is orphaned by
-- this. If that is no longer true when you run it, read the values out
-- first:
--   select id, title, sponsor_name, sponsor_tagline, sponsor_logo_url, pledge_amount
--   from public.mosaic_projects where sponsor_name is not null
--      or sponsor_logo_url is not null or sponsor_tagline is not null;
--
-- `if exists` on every drop, so re-running it (or running it on a database
-- that never had supabase_mosaic_sponsor.sql) is a no-op.

alter table public.mosaic_projects
  drop column if exists sponsor_name,
  drop column if exists sponsor_logo_url,
  drop column if exists sponsor_tagline,
  drop column if exists pledge_amount;
