-- Run this once in the Supabase SQL editor (Project → SQL Editor → New query).
-- Run AFTER supabase_mosaic_art_details.sql and supabase_mosaic_edit_art_details.sql.
-- Idempotent — safe to run again.
--
-- "Process story" (작업 이야기, 2026-10-01): a second free-text field on an
-- artwork, next to the artwork story (art_description). Where the artwork
-- story says what the piece is about, this one says how the artist works —
-- e.g. "I have low vision, so I work close to the canvas and lean on
-- contrast and texture". Shown as its own card in the lightbox / artwork
-- page (js/lightbox.js) and set from the upload form (js/profile-view.js),
-- which pre-fills it with the artist's most recent process story — that is
-- just a read of their own latest artwork, so nothing else is stored.
--
-- Until this runs, the upload form and the edit dialog hide the field and
-- the lightbox shows no process card; everything else works as before.

alter table public.mosaic_submissions add column if not exists art_process text;

alter table public.mosaic_submissions
  drop constraint if exists mosaic_submissions_art_process_len;
alter table public.mosaic_submissions
  add constraint mosaic_submissions_art_process_len check (char_length(art_process) <= 500);

-- Column-level privileges are additive: the author can write this one
-- column on insert and on update (the update RLS policy from
-- supabase_mosaic_edit_art_details.sql already limits rows to their own).
grant insert (art_process), update (art_process) on public.mosaic_submissions to authenticated;
