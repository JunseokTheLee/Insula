-- Run this once in the Supabase SQL editor (Project → SQL Editor → New query).
-- Run AFTER supabase_mosaic_collections.sql.
--
-- Adds a publish/unpublish lifecycle to collections ("Exhibitions") on top
-- of the existing is_public (private/public-by-link) flag. A brand new
-- exhibition starts unpublished — the owner has to go into it and publish
-- it themselves before it's surfaced anywhere discovery-oriented (the
-- landing page's Latest Exhibitions list, the /exhibitions browse-all
-- page). is_public still governs whether the exhibition's own page is even
-- viewable by a non-owner at all; is_published is an *additional* gate on
-- top of that for the "we're actively broadcasting this" surfaces, so both
-- must be true for an exhibition to appear there.
--
-- end_date is an optional self-expiry: once it's passed, the exhibition
-- reads as unpublished again everywhere, without the owner having to
-- remember to toggle it off by hand. This is computed at query time
-- (is_published AND (end_date IS NULL OR end_date >= today)) rather than
-- flipping the stored is_published column via a scheduled job — this repo
-- has no cron/scheduled-function infra (see supabase_mosaic_pixel_autoreset.sql's
-- trigger-based approach for the same reasoning applied elsewhere), and a
-- computed check keeps every reader (client queries, any future server
-- render) in agreement without needing one more moving part.

alter table public.mosaic_collections
  add column if not exists is_published boolean not null default false,
  add column if not exists published_at timestamptz,
  add column if not exists end_date date;

comment on column public.mosaic_collections.is_published is
  'Owner-controlled publish flag — gates the landing page / browse-all discovery surfaces only, independent of is_public (which gates the exhibition''s own page).';
comment on column public.mosaic_collections.end_date is
  'Optional self-expiry date. Once passed, readers should treat the exhibition as unpublished even though is_published is still true — see the query-time check described above.';
