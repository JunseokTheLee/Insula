-- Run this once in the Supabase SQL editor (Project → SQL Editor → New query).
-- Run AFTER supabase_mosaic.sql and supabase_mosaic_art_details.sql.
--
-- Lets an artist edit the text details of their own already-submitted
-- artwork — title, material, completed date, artist statement, link —
-- from the lightbox / standalone artwork page (js/lightbox.js's "Edit"
-- button). Mirrors the existing author-or-admin DELETE policy just below
-- the INSERT policy in supabase_mosaic.sql, but scoped to the author only:
-- there's no reason for an admin to rewrite someone else's statement, and
-- moderation already has "remove from project" / delete.
--
-- The image itself, its average color, and the piece's project/pixel
-- placement are deliberately NOT editable here — changing the image would
-- mean re-running color matching and reassigning cells, which is a
-- delete-and-resubmit, not an edit.

drop policy if exists "Authors can edit their own submission details" on public.mosaic_submissions;
create policy "Authors can edit their own submission details"
  on public.mosaic_submissions for update
  using (auth.uid() = author_id)
  with check (auth.uid() = author_id);

-- Column-scoped so an author can only touch the five detail fields — not
-- author_id, image_url, thumb_url, avg_r/g/b, project_id or pixel_id. The
-- existing length / date-range check constraints from supabase_mosaic.sql
-- and supabase_mosaic_art_details.sql are re-checked on UPDATE automatically.
grant update (art_title, art_material, art_completed_date, art_description, art_link)
  on public.mosaic_submissions to authenticated;
