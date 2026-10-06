-- Run this once in the Supabase SQL editor (Project → SQL Editor → New query).
-- Run AFTER supabase_mosaic.sql, supabase_profiles.sql and
-- supabase_mosaic_pieces.sql. Idempotent — safe to run again.
--
-- Member type: artist or member (2026-10-07, user decision).
--
-- Weavo has two kinds of members: ARTISTS, who upload artworks and keep
-- portfolios, and MEMBERS, who look, like, follow and play the games. The
-- choice is the person's own (sign-up form and profile edit); the default
-- for a new account is 'member'.
--
-- 1. profiles.member_type ('artist' | 'member', default 'member') and the
--    column grants the profile form's upsert needs (insert + update).
-- 2. Backfill: everyone who has uploaded an artwork is an artist, everyone
--    else a member.
-- 3. Uploading makes you an artist: an AFTER INSERT trigger on
--    mosaic_submissions promotes the author, so the flag can never say
--    'member' for someone whose artworks are on the site (the upload button
--    only shows for artists, but the API does not need the button).

-- ── 1. column ───────────────────────────────────────────────────────────
alter table public.profiles add column if not exists member_type text not null default 'member';
alter table public.profiles drop constraint if exists profiles_member_type_check;
alter table public.profiles add constraint profiles_member_type_check check (member_type in ('artist', 'member'));
grant insert (member_type), update (member_type) on public.profiles to authenticated;

-- ── 2. backfill ─────────────────────────────────────────────────────────
update public.profiles p
set member_type = case
  when exists (select 1 from public.mosaic_submissions s where s.author_id = p.id and s.parent_id is null) then 'artist'
  else 'member' end
where p.member_type is distinct from case
  when exists (select 1 from public.mosaic_submissions s where s.author_id = p.id and s.parent_id is null) then 'artist'
  else 'member' end;

-- ── 3. an upload makes the author an artist ─────────────────────────────
create or replace function public.promote_uploader_to_artist()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.parent_id is null then
    update public.profiles set member_type = 'artist'
    where id = new.author_id and member_type <> 'artist';
  end if;
  return new;
end;
$$;

drop trigger if exists mosaic_submissions_promote_artist on public.mosaic_submissions;
create trigger mosaic_submissions_promote_artist
  after insert on public.mosaic_submissions
  for each row execute function public.promote_uploader_to_artist();
