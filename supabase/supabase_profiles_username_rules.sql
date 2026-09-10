-- Run this once in the Supabase SQL editor (Project → SQL Editor → New query).
-- Run AFTER supabase_profiles.sql.
--
-- Server-side guard for usernames, kept in sync with usernameFormatError()
-- in js/auth.js. The client validates the same rules live while typing, but
-- the CHECK below is the real backstop (a request can reach PostgREST without
-- the app's JS). Rules: 2–30 characters, no leading/trailing whitespace, no
-- '/' or '\' (either would break the /artists/<handle> route), and a short
-- reserved list. Deliberately permissive otherwise — spaces and non-Latin
-- scripts stay allowed, so existing names ("Seojin Oh", "박건우", …) remain
-- valid and their owners can still edit their profiles.
--
-- Safe against current data: verified no existing username is <2/>30 chars or
-- contains a slash/backslash/reserved word. Added NOT VALID first, then
-- validated separately, so the ADD still succeeds (and simply reports) even if
-- some row slipped in that violates it.

alter table public.profiles
  drop constraint if exists profiles_username_format;

alter table public.profiles
  add constraint profiles_username_format check (
    username is null or (
      char_length(username) between 2 and 30
      and username = btrim(username)
      and strpos(username, '/') = 0
      and strpos(username, chr(92)) = 0          -- chr(92) = backslash
      and lower(username) not in ('me', 'admin', 'null', 'undefined', 'anonymous', 'weavo')
    )
  ) not valid;

alter table public.profiles
  validate constraint profiles_username_format;
