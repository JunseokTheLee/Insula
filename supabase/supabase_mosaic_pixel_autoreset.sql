-- Run this once in the Supabase SQL editor (Project → SQL Editor → New query).
-- Run AFTER supabase_mosaic.sql.
--
-- Bug: deleteWeavoSubmission() in weavo.html deletes the mosaic_submissions
-- row, then makes a SEPARATE client-side call to reset that submission's
-- mosaic_pixels row back to open (filled=false, submission_id/claimed_by/
-- claimed_at=null). The FK's "on delete set null" only clears submission_id
-- automatically — filled stays true. So any deletion that doesn't go through
-- that exact app code path (deleting straight from the table editor or SQL
-- editor, or a future code path that forgets the second call) leaves the
-- cell permanently stuck as filled=true/submission_id=null: it never opens
-- back up for a new submission, and it permanently inflates fill_percent
-- (supabase_mosaic_stats.sql) and every project's own progress figure.
--
-- Fix: move the reset into a trigger on mosaic_submissions so it happens
-- atomically with the delete itself, regardless of what deleted the row.

create or replace function public.reset_pixel_on_submission_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.mosaic_pixels
  set filled = false, submission_id = null, claimed_by = null, claimed_at = null
  where id = old.pixel_id;
  return old;
end;
$$;

drop trigger if exists mosaic_submission_deleted on public.mosaic_submissions;
create trigger mosaic_submission_deleted
  after delete on public.mosaic_submissions
  for each row execute function public.reset_pixel_on_submission_delete();

-- One-time cleanup: any pixel already left stuck by a past direct deletion
-- (filled=true but no submission attached, since the row it pointed at is
-- gone) gets reopened right now.
update public.mosaic_pixels
set filled = false, claimed_by = null, claimed_at = null
where filled = true and submission_id is null;
