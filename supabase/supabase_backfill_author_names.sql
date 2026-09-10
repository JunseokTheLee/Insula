-- Run this once in the Supabase SQL editor (Project → SQL Editor → New query).
--
-- author_name / authorName is snapshotted at write time onto each row rather
-- than looked up live, so posts/comments made before profiles.username
-- existed (or before a user set one) were stamped with their Google account
-- name. This backfills those existing rows to the site username, for every
-- table that stores a snapshotted author_name and has an author_id/author
-- column pointing at auth.users. New rows already use username || name as of
-- the index.html / main.html / profile.js fix.
--
-- Safe to re-run: it only touches rows whose author_name still differs from
-- the profile's current username.
--
-- Note: cell_comments (from supabase_cell_comments.sql) is skipped here —
-- that table isn't actually created in this project's database and nothing
-- in the app writes to it.

update public.cells c
set author_name = p.username
from public.profiles p
where p.id = c.author_id
  and p.username is not null
  and p.username <> ''
  and c.author_name is distinct from p.username;

update public.mosaic_submissions s
set author_name = p.username
from public.profiles p
where p.id = s.author_id
  and p.username is not null
  and p.username <> ''
  and s.author_name is distinct from p.username;

update public.mosaic_submission_comments mc
set author_name = p.username
from public.profiles p
where p.id = mc.author_id
  and p.username is not null
  and p.username <> ''
  and mc.author_name is distinct from p.username;

update public.profile_comments pc
set author_name = p.username
from public.profiles p
where p.id = pc.author_id
  and p.username is not null
  and p.username <> ''
  and pc.author_name is distinct from p.username;
