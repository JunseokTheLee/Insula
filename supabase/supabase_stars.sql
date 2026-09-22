-- Run this once in the Supabase SQL editor (Project → SQL Editor → New query).
-- Run AFTER supabase_game.sql, supabase_game_medal_rules.sql,
-- supabase_pixel_game.sql, supabase_pixel_levels.sql and
-- supabase_portfolios.sql. Idempotent — safe to run again.
--
-- CONSTELLATIONS (2026-09-21, user request). Finishing an artwork in either
-- game lights one star. Six stars make a constellation; every constellation
-- somebody completes lights one star of the shared whale in the sky.
--
-- Why a table of its own rather than reading the two games' records:
--   * A star must OUTLIVE its artwork. game_best_records and pixel_progress
--     both cascade away when the artwork (or its campaign) is deleted, and a
--     player's night sky going dark because an artist removed a picture would
--     be the worst possible bug for a feature about permanence. So this table
--     keeps its own copy of the title and the artist's name and has NO foreign
--     key on artwork_id.
--   * The two games store completion very differently (a best time per
--     campaign+artwork vs. progress per level). One flat row per earned star
--     keeps every reader — the sky, the profile strip, the whale — simple.
--
-- Nothing but the triggers below ever writes here: there is no insert grant,
-- so a client cannot hand itself stars.

-- ── 1. hiding your own sky ───────────────────────────────────────────────
-- Stars are public by default (the point is to be seen); this opts out.
alter table public.profiles
  add column if not exists stars_hidden boolean not null default false;
grant update (stars_hidden) on public.profiles to authenticated;

-- ── 2. the stars ─────────────────────────────────────────────────────────
-- One row per (player, artwork, game). Replaying the same artwork never adds
-- a star; finishing a HIGHER colouring level raises `level` on the row it
-- already has, which the sky draws as a brighter star.
create table if not exists public.user_stars (
  user_id     uuid not null references auth.users(id) on delete cascade,
  artwork_id  bigint not null,
  source      text not null check (source in ('find', 'color')),
  art_title   text,
  author_id   uuid,
  author_name text,
  level       smallint,
  earned_at   timestamptz not null default now(),
  primary key (user_id, artwork_id, source)
);

-- The sky fills in the order the stars were earned, and that order must be
-- DETERMINISTIC: two stars can share a timestamp (finishing both games on the
-- same artwork through a backfill), and an order that shuffled between two
-- reads would move stars around the sky. earned_at → artwork_id → source is
-- unique because (artwork_id, source) is unique within one player.
create index if not exists user_stars_order_idx
  on public.user_stars (user_id, earned_at, artwork_id, source);
-- "How many skies is this artwork shining in" (the artist's side).
create index if not exists user_stars_artwork_idx
  on public.user_stars (artwork_id);

alter table public.user_stars enable row level security;

drop policy if exists "Stars are visible unless their owner hides them" on public.user_stars;
create policy "Stars are visible unless their owner hides them"
  on public.user_stars for select
  using (
    user_id = auth.uid()
    or not exists (select 1 from public.profiles p where p.id = user_id and p.stars_hidden)
  );

-- Supabase grants ALL on new public tables to anon/authenticated, so take it
-- back first and hand out only the read (CLAUDE.md §6). No insert/update/
-- delete for anybody: the triggers below run as the owner.
revoke all on public.user_stars from anon, authenticated;
grant select on public.user_stars to anon, authenticated;

-- ── 3. awarding a star ───────────────────────────────────────────────────
create or replace function public.award_star(
  p_user_id uuid, p_artwork_id bigint, p_source text, p_level integer default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_art public.mosaic_submissions%rowtype;
begin
  if p_user_id is null or p_artwork_id is null then
    return;
  end if;
  select * into v_art from public.mosaic_submissions where id = p_artwork_id;
  -- A piece has no star of its own; the games only ever name whole artworks.
  if found and v_art.parent_id is not null then
    return;
  end if;
  insert into public.user_stars (user_id, artwork_id, source, art_title, author_id, author_name, level)
  values (p_user_id, p_artwork_id, p_source, v_art.art_title, v_art.author_id, v_art.author_name,
          case when p_source = 'color' then p_level::smallint end)
  on conflict (user_id, artwork_id, source) do update
    -- Keep the first earned_at (the sky's order must not move), raise the level.
    set level = greatest(coalesce(public.user_stars.level, 0), coalesce(excluded.level, 0)),
        art_title = coalesce(excluded.art_title, public.user_stars.art_title),
        author_name = coalesce(excluded.author_name, public.user_stars.author_name);
end;
$$;
revoke execute on function public.award_star(uuid, bigint, text, integer) from public, anon, authenticated;

-- Find the piece: the first personal record on an artwork is the star. Later
-- records are UPDATEs of the same row, so AFTER INSERT fires exactly once.
create or replace function public.award_star_find()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.award_star(new.user_id, new.artwork_id, 'find', null);
  return new;
end;
$$;
drop trigger if exists award_star_on_find on public.game_best_records;
create trigger award_star_on_find
  after insert on public.game_best_records
  for each row execute function public.award_star_find();

-- Colour by number: the star comes the moment completed_at is first set on a
-- row (any level). A row is INSERTed already complete when the whole board is
-- filled before the first save, so both events matter.
create or replace function public.award_star_color()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.completed_at is not null and (tg_op = 'INSERT' or old.completed_at is null) then
    perform public.award_star(new.user_id, new.artwork_id, 'color', new.level);
  end if;
  return new;
end;
$$;
drop trigger if exists award_star_on_color on public.pixel_progress;
create trigger award_star_on_color
  after insert or update on public.pixel_progress
  for each row execute function public.award_star_color();

-- ── 4. backfill ──────────────────────────────────────────────────────────
-- Everyone who already finished something keeps it: the sky is not empty on
-- the day it opens. earned_at is the real completion time, so the existing
-- players' constellations are in the order they actually played.
insert into public.user_stars (user_id, artwork_id, source, art_title, author_id, author_name, level, earned_at)
select r.user_id, r.artwork_id, 'find', s.art_title, s.author_id, s.author_name, null, r.completed_at
from public.game_best_records r
left join public.mosaic_submissions s on s.id = r.artwork_id
where s.id is null or s.parent_id is null
on conflict (user_id, artwork_id, source) do nothing;

insert into public.user_stars (user_id, artwork_id, source, art_title, author_id, author_name, level, earned_at)
select p.user_id, p.artwork_id, 'color', min(s.art_title), min(s.author_id), min(s.author_name),
       max(p.level)::smallint, min(p.completed_at)
from public.pixel_progress p
left join public.mosaic_submissions s on s.id = p.artwork_id
where p.completed_at is not null and (s.id is null or s.parent_id is null)
group by p.user_id, p.artwork_id
on conflict (user_id, artwork_id, source) do nothing;

-- ── 5. reading a sky ─────────────────────────────────────────────────────
-- One player's stars in the order they light. `thumb` is the live artwork and
-- is null once the artwork is gone or private — title and artist stay, so a
-- star is never blank. `seq` is the position in the sky; the client divides it
-- by the constellation size.
create or replace function public.user_star_list(p_user_id uuid, p_limit integer default 400)
returns table (
  seq integer, artwork_id bigint, source text, art_title text,
  author_id uuid, author_name text, level smallint, earned_at timestamptz,
  thumb text, alive boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select (row_number() over (order by us.earned_at, us.artwork_id, us.source))::integer - 1,
         us.artwork_id, us.source, us.art_title, us.author_id, us.author_name, us.level, us.earned_at,
         case when s.id is not null and (s.is_public or s.author_id = auth.uid())
              then coalesce(s.thumb_url, s.image_url) end,
         (s.id is not null)
  from public.user_stars us
  left join public.mosaic_submissions s on s.id = us.artwork_id
  where us.user_id = p_user_id
    and (
      p_user_id = auth.uid()
      or not exists (select 1 from public.profiles p where p.id = p_user_id and p.stars_hidden)
    )
  order by us.earned_at, us.artwork_id, us.source
  limit greatest(1, least(coalesce(p_limit, 400), 2000));
$$;
revoke execute on function public.user_star_list(uuid, integer) from public;
grant execute on function public.user_star_list(uuid, integer) to anon, authenticated;

-- How many skies each artwork is shining in — the artist's side of the game
-- (shown on the artwork and on the artist's profile). Counts every player,
-- hidden skies included: this is about the artwork, and it names nobody.
create or replace function public.artwork_star_counts(p_ids bigint[])
returns table (artwork_id bigint, stars integer, players integer)
language sql
stable
security definer
set search_path = public
as $$
  select us.artwork_id, count(*)::integer, count(distinct us.user_id)::integer
  from public.user_stars us
  where us.artwork_id = any(p_ids)
  group by us.artwork_id;
$$;
revoke execute on function public.artwork_star_counts(bigint[]) from public;
grant execute on function public.artwork_star_counts(bigint[]) to anon, authenticated;

-- ── 6. the shared whale ──────────────────────────────────────────────────
-- Every constellation anybody completes lights one star of the whale, in the
-- order the constellations were finished. Nothing is stored: the whale is
-- derived, so it can never disagree with the stars it is made of.
--
-- 6 is the constellation size and MUST match STAR_CONSTELLATION_SIZE in
-- js/constellations.js — the shapes there have exactly six slots each.
--
-- One player may light only the first few (site option whaleStarsPerPlayer,
-- default 3). Without a cap the whale stops meaning "together": with 100
-- public artworks one person can finish 33 constellations and would light
-- two thirds of a 48-star whale alone. At 3 the whale needs 16 people.
-- Accounts excluded from rankings are left out entirely; a player who hides
-- their sky still lights their star, without their name on it.
create or replace function public.whale_stars(p_limit integer default 400)
returns table (
  idx integer, user_id uuid, username text, avatar_url text,
  constellation integer, earned_at timestamptz, hidden boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with numbered as (
    select us.user_id, us.earned_at, us.artwork_id, us.source,
           row_number() over (partition by us.user_id
                              order by us.earned_at, us.artwork_id, us.source) as n
    from public.user_stars us
    join public.profiles p on p.id = us.user_id
    where not coalesce(p.ranking_excluded, false)
  ),
  done as (
    select user_id, earned_at, (n / 6)::integer as constellation,
           row_number() over (partition by user_id order by earned_at, n) as kth
    from numbered
    where n % 6 = 0
  )
  select (row_number() over (order by d.earned_at, d.user_id, d.constellation))::integer - 1,
         d.user_id,
         case when coalesce(p.stars_hidden, false) then null else coalesce(p.username, p.name) end,
         case when coalesce(p.stars_hidden, false) then null else p.avatar_url end,
         d.constellation, d.earned_at, coalesce(p.stars_hidden, false)
  from done d
  join public.profiles p on p.id = d.user_id
  where d.kth <= greatest(1, coalesce((select (settings->>'whaleStarsPerPlayer')::integer
                                       from public.site_settings where id = true), 3))
  order by d.earned_at, d.user_id, d.constellation
  limit greatest(1, least(coalesce(p_limit, 400), 2000));
$$;
revoke execute on function public.whale_stars(integer) from public;
grant execute on function public.whale_stars(integer) to anon, authenticated;
