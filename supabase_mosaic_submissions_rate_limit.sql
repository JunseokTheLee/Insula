-- Run this once in the Supabase SQL editor (Project → SQL Editor → New query).
-- Run AFTER supabase_mosaic_profile_pool.sql (this targets the bare-upload
-- insert path it introduces).
--
-- The anon/publishable key used by js/supabase-client.js is meant to be
-- public — RLS is the actual security boundary, not the key's secrecy. That
-- means a scripted caller can hit PostgREST's insert endpoint directly, as
-- fast as the network allows, completely bypassing profile-view.js's upload
-- UI. Each mosaic_submissions insert is expensive on both sides: two Storage
-- objects (full + thumbnail) get written, and it triggers runPoolMatching()
-- (js/matching.js) for every visitor currently on the site, which itself
-- re-reads the whole unmatched pool and every open cell across every active
-- project. A tight insert loop would multiply both costs with no natural
-- ceiling. Client-side throttling can't stop this — it has to be enforced
-- where the abuser can't route around it: in Postgres itself.
--
-- Limit is deliberately generous (20 uploads / 10 minutes per author) so a
-- real artist batch-uploading an existing portfolio never trips it — this
-- is meant to catch a runaway script, not to pace normal use.

create or replace function public.enforce_mosaic_submission_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window     constant interval := interval '10 minutes';
  v_max_uploads constant int := 20;
  v_recent_count int;
begin
  select count(*) into v_recent_count
  from public.mosaic_submissions
  where author_id = new.author_id
    and created_at > now() - v_window;

  if v_recent_count >= v_max_uploads then
    raise exception 'upload rate limit exceeded — please wait a few minutes and try again'
      using errcode = 'RATE1';
  end if;

  return new;
end;
$$;

drop trigger if exists mosaic_submissions_rate_limit on public.mosaic_submissions;
create trigger mosaic_submissions_rate_limit
  before insert on public.mosaic_submissions
  for each row execute function public.enforce_mosaic_submission_rate_limit();
