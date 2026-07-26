-- Run this once in the Supabase SQL editor (Project → SQL Editor → New query).
-- Adds country/city fields to profiles, used by artconnect.html to group
-- artists by country (matches the ISO 3166-1 numeric ids used for map/flag
-- lookups client-side — see COUNTRY_NAMES in artconnect.html).

alter table public.profiles
  add column if not exists country_id integer,
  add column if not exists city       text;
