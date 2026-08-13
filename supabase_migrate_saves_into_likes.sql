-- Run this ONCE in the Supabase SQL editor, after deploying the app code
-- that stops writing to mosaic_submission_saves (js/lightbox.js's old
-- "Collect" button) and before/after re-running supabase_mosaic_likes.sql.
--
-- Folds artwork saves into artwork likes: a piece a user had saved but not
-- liked becomes liked, so no engagement is lost. A piece already liked and
-- saved by the same user contributes only one row (the pair is the primary
-- key on both tables).

insert into public.mosaic_submission_likes (submission_id, user_id, created_at)
select submission_id, user_id, created_at
from public.mosaic_submission_saves
on conflict (submission_id, user_id) do nothing;

drop table if exists public.mosaic_submission_saves;
