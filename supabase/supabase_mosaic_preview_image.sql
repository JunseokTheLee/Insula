-- Run this once in the Supabase SQL editor (Project → SQL Editor → New query).
-- Run AFTER supabase_mosaic_grid_image.sql.
--
-- Share image per campaign (2026-09-10). Campaign pages used to hand the
-- reference photo itself (reference_image_url) to social previews and
-- crawlers as og:image / JSON-LD image — exposing the very picture the
-- campaign keeps hidden until it is complete. Pages now use
-- preview_image_url: a 1200×630 card showing the campaign as the site does
-- (its cells in grey), rendered in the browser on create / reshape and
-- rebuilt for older campaigns from the admin page; when a campaign has none
-- the site logo is used instead. The existing admin insert/update policies
-- on mosaic_projects cover the column.

alter table public.mosaic_projects add column if not exists preview_image_url text;
