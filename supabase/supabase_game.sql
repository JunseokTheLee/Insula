-- Run this once in the Supabase SQL editor (Project → SQL Editor → New query).
-- Run AFTER supabase_mosaic_pieces.sql (it reads parent_id / piece_n) and
-- supabase_site_settings.sql (it reads the game options).
--
-- "Find the piece" game: a player picks an artwork that has at least one
-- piece sitting in the current campaign's mosaic, then hunts those pieces
-- down in the mosaic. Fastest completion per (campaign, artwork) is ranked.
--
-- WHY THE TIMING LIVES HERE, NOT IN THE BROWSER
-- A time the browser reports can be edited in devtools before it is sent.
-- So the browser never sends one: start_game stamps the server clock,
-- finish_game reads the server clock again and subtracts. The on-screen
-- timer is display only.
--
-- WHAT THIS CAN AND CANNOT VERIFY
-- It verifies that the session exists, belongs to the caller, was not
-- already finished, names a real artwork with pieces in a live campaign,
-- and that the elapsed time is not physically impossible (a floor per
-- piece). It CANNOT verify that the player truly located every piece —
-- this is a static site with no trusted game server, and the client is what
-- decides it is done. The time floor is the honest limit of the defence.

-- ── 1. game_sessions ─────────────────────────────────────────────────────
-- One row per started game. Anonymous players never get one (the client
-- doesn't call start_game without a session), so user_id is not nullable.
create table if not exists public.game_sessions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  project_id    bigint not null references public.mosaic_projects(id) on delete cascade,
  artwork_id    bigint not null references public.mosaic_submissions(id) on delete cascade,
  -- How many of this artwork's pieces were in the mosaic when play started.
  -- Frozen here so a mosaic change mid-game cannot alter what "finished"
  -- means, and so the time floor below has something to scale with.
  target_pieces integer not null check (target_pieces > 0),
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  elapsed_ms    integer
);

create index if not exists game_sessions_user_idx
  on public.game_sessions (user_id, started_at desc);

alter table public.game_sessions enable row level security;

drop policy if exists "Players read their own game sessions" on public.game_sessions;
create policy "Players read their own game sessions"
  on public.game_sessions for select
  using (user_id = auth.uid());

-- Sessions are created and closed ONLY by the RPCs below — a direct insert
-- would let a client pick its own started_at, which is the whole thing this
-- design exists to prevent. Supabase grants ALL on new public tables to
-- anon/authenticated by default, so revoke first (CLAUDE.md §6).
revoke all on public.game_sessions from anon, authenticated;
grant select on public.game_sessions to authenticated;

-- ── 2. game_best_records ────────────────────────────────────────────────
-- One row per (campaign, artwork, player): their fastest run. Kept separate
-- from the session history so the leaderboard is a simple indexed read.
create table if not exists public.game_best_records (
  project_id   bigint not null references public.mosaic_projects(id) on delete cascade,
  artwork_id   bigint not null references public.mosaic_submissions(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  elapsed_ms   integer not null check (elapsed_ms > 0),
  completed_at timestamptz not null default now(),
  primary key (project_id, artwork_id, user_id)
);

-- The leaderboard's sort order, and it must be DETERMINISTIC: two players
-- can finish on the same millisecond, and a tie that reorders between two
-- reads would make ranks jump around. elapsed → completed_at → user_id is
-- unique because user_id is unique within (project, artwork).
create index if not exists game_best_records_rank_idx
  on public.game_best_records (project_id, artwork_id, elapsed_ms, completed_at, user_id);

alter table public.game_best_records enable row level security;

-- Rankings are public: everyone sees the leaderboard on the game page.
drop policy if exists "Anyone can read game records" on public.game_best_records;
create policy "Anyone can read game records"
  on public.game_best_records for select
  using (true);

-- Written only by finish_game. A client that could insert here could write
-- any time it liked.
revoke all on public.game_best_records from anon, authenticated;
grant select on public.game_best_records to anon, authenticated;

-- ── 3. helper: pieces of one artwork in one campaign ─────────────────────
-- Counts the cells in project p_project_id that are filled by a piece of
-- artwork p_artwork_id (or by the artwork row itself, for pre-piece data).
create or replace function public.game_used_piece_count(p_project_id bigint, p_artwork_id bigint)
returns integer
language sql
stable
security definer
set search_path = public
as $fn$
  select count(*)::integer
  from public.mosaic_pixels px
  join public.mosaic_submissions s on s.id = px.submission_id
  where px.project_id = p_project_id
    and px.filled
    and px.submission_id is not null
    and coalesce(s.parent_id, s.id) = p_artwork_id;
$fn$;

revoke execute on function public.game_used_piece_count(bigint, bigint) from public;
grant execute on function public.game_used_piece_count(bigint, bigint) to anon, authenticated;

-- ── 4. game_artwork_stats: the whole leaderboard in ONE request ──────────
-- Returns, for every artwork with at least one piece in this campaign's
-- mosaic: the top 3 records and the caller's own best plus rank. Doing this
-- per artwork would be an N+1 across ~30 artworks on a page that already
-- loads the mosaic.
--
-- Names come from profiles the same way the rest of the site resolves a
-- display name (username first, then name) — never an email.
create or replace function public.game_artwork_stats(p_project_id bigint)
returns jsonb
language sql
stable
security definer
set search_path = public
as $fn$
  with ranked as (
    select r.artwork_id, r.user_id, r.elapsed_ms, r.completed_at,
           row_number() over (
             partition by r.artwork_id
             order by r.elapsed_ms, r.completed_at, r.user_id
           ) as rn
    from public.game_best_records r
    where r.project_id = p_project_id
  ),
  top3 as (
    select k.artwork_id,
           jsonb_agg(jsonb_build_object(
             'name', coalesce(p.username, p.name, ''),
             'ms',   k.elapsed_ms
           ) order by k.rn) as rows
    from ranked k
    left join public.profiles p on p.id = k.user_id
    where k.rn <= 3
    group by k.artwork_id
  ),
  mine as (
    select k.artwork_id, k.elapsed_ms, k.rn
    from ranked k
    where auth.uid() is not null and k.user_id = auth.uid()
  )
  select coalesce(jsonb_object_agg(a.artwork_id::text, jsonb_build_object(
           'top',     coalesce(t.rows, '[]'::jsonb),
           'mine_ms', m.elapsed_ms,
           'mine_rank', m.rn
         )), '{}'::jsonb)
  from (select distinct artwork_id from ranked) a
  left join top3 t on t.artwork_id = a.artwork_id
  left join mine m on m.artwork_id = a.artwork_id;
$fn$;

revoke execute on function public.game_artwork_stats(bigint) from public;
grant execute on function public.game_artwork_stats(bigint) to anon, authenticated;

-- ── 5. start_game ───────────────────────────────────────────────────────
-- Opens a session and stamps the server clock. Everything the finish step
-- needs to judge the run is decided HERE, while the player has not started.
create or replace function public.start_game(p_project_id bigint, p_artwork_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_used    integer;
  v_enabled boolean;
  v_id      uuid;
begin
  if auth.uid() is null then
    raise exception 'sign-in required';
  end if;

  -- The admin switch is enforced server-side too, not just by hiding the
  -- button (CLAUDE.md §16).
  select coalesce((settings->>'gameEnabled')::boolean, true) into v_enabled
  from public.site_settings where id = true;
  if v_enabled is false then
    raise exception 'game disabled';
  end if;

  -- The campaign must be live, and the artwork must actually have pieces in
  -- it — otherwise there is nothing to find and no honest record to set.
  if not exists (
    select 1 from public.mosaic_projects
    where id = p_project_id and not is_archived
  ) then
    raise exception 'campaign not available';
  end if;

  v_used := public.game_used_piece_count(p_project_id, p_artwork_id);
  if v_used < 1 then
    raise exception 'artwork has no pieces in this campaign';
  end if;

  insert into public.game_sessions (user_id, project_id, artwork_id, target_pieces)
  values (auth.uid(), p_project_id, p_artwork_id, v_used)
  returning id into v_id;

  return jsonb_build_object('session_id', v_id, 'target_pieces', v_used);
end;
$fn$;

revoke execute on function public.start_game(bigint, bigint) from public, anon;
grant execute on function public.start_game(bigint, bigint) to authenticated;

-- ── 6. finish_game ──────────────────────────────────────────────────────
-- Closes a session, computes the time from the server clock, and updates
-- the player's best if it beat it.
--
-- IDEMPOTENT: calling it twice on one session returns the same result
-- instead of recording a second run — the client retries this when the
-- network drops after a finished game (a player who just set a record and
-- lost it to a timeout would rightly be furious).
create or replace function public.finish_game(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_s        public.game_sessions;
  v_elapsed  integer;
  v_floor    integer;
  v_prev     integer;
  v_best     integer;
  v_rank     integer;
  v_total    integer;
  v_pb       boolean := false;
begin
  if auth.uid() is null then
    raise exception 'sign-in required';
  end if;

  select * into v_s from public.game_sessions
  where id = p_session_id and user_id = auth.uid();
  if v_s.id is null then
    raise exception 'session not found';
  end if;

  if v_s.finished_at is not null then
    -- Already closed: report the same outcome rather than recording again.
    v_elapsed := v_s.elapsed_ms;
  else
    v_elapsed := greatest(1, (extract(epoch from (now() - v_s.started_at)) * 1000)::integer);

    -- A floor of 250 ms per piece. Finding a piece needs a look, a decision
    -- and a tap; anything under this is a script, not a player. Rejecting
    -- outright (rather than clamping) keeps a forged run out of the table.
    v_floor := v_s.target_pieces * 250;
    if v_elapsed < v_floor then
      raise exception 'implausible time';
    end if;

    update public.game_sessions
       set finished_at = now(), elapsed_ms = v_elapsed
     where id = v_s.id;
  end if;

  select elapsed_ms into v_prev from public.game_best_records
  where project_id = v_s.project_id and artwork_id = v_s.artwork_id and user_id = auth.uid();

  if v_prev is null or v_elapsed < v_prev then
    insert into public.game_best_records (project_id, artwork_id, user_id, elapsed_ms, completed_at)
    values (v_s.project_id, v_s.artwork_id, auth.uid(), v_elapsed, now())
    on conflict (project_id, artwork_id, user_id) do update
      set elapsed_ms = excluded.elapsed_ms, completed_at = excluded.completed_at;
    v_pb := v_prev is not null;   -- first-ever run is not a "personal best"
  end if;

  select elapsed_ms into v_best from public.game_best_records
  where project_id = v_s.project_id and artwork_id = v_s.artwork_id and user_id = auth.uid();

  -- Same ordering as the leaderboard index, so the rank shown here is the
  -- rank the list will show.
  select count(*)::integer + 1 into v_rank
  from public.game_best_records r
  where r.project_id = v_s.project_id and r.artwork_id = v_s.artwork_id
    and (r.elapsed_ms, r.completed_at, r.user_id) <
        (select b.elapsed_ms, b.completed_at, b.user_id from public.game_best_records b
         where b.project_id = v_s.project_id and b.artwork_id = v_s.artwork_id and b.user_id = auth.uid());

  select count(*)::integer into v_total
  from public.game_best_records
  where project_id = v_s.project_id and artwork_id = v_s.artwork_id;

  return jsonb_build_object(
    'elapsed_ms',    v_elapsed,
    'best_ms',       v_best,
    'personal_best', v_pb,
    'rank',          v_rank,
    'players',       v_total,
    'first_record',  v_total = 1 and v_rank = 1
  );
end;
$fn$;

revoke execute on function public.finish_game(uuid) from public, anon;
grant execute on function public.finish_game(uuid) to authenticated;

-- ── 7. game_medal_counts: a player's podium finishes ────────────────────
-- Added 2026-09-13 for the profile page. Re-running this whole file is safe
-- (everything in it is idempotent), so this section can be applied by just
-- running supabase_game.sql again.
--
-- A "medal" is a current standing, not a trophy handed out once: if someone
-- beats your time you lose the gold, exactly as the leaderboard shows. The
-- ordering is the same deterministic one the leaderboard and finish_game
-- use, so the three places always agree.
create or replace function public.game_medal_counts(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $fn$
  with ranked as (
    select r.user_id,
           row_number() over (
             partition by r.project_id, r.artwork_id
             order by r.elapsed_ms, r.completed_at, r.user_id
           ) as rn
    from public.game_best_records r
  )
  select jsonb_build_object(
    'gold',    count(*) filter (where rn = 1),
    'silver',  count(*) filter (where rn = 2),
    'bronze',  count(*) filter (where rn = 3),
    'records', count(*)
  )
  from ranked
  where user_id = p_user_id;
$fn$;

-- Public: a profile page is public, so its medal row is too.
revoke execute on function public.game_medal_counts(uuid) from public;
grant execute on function public.game_medal_counts(uuid) to anon, authenticated;

-- ── 8. hint penalty ──────────────────────────────────────────────────────
-- Added 2026-09-13. Re-running this file is safe.
--
-- A sector hint narrows ~5,000 cells to a few hundred, which is close to
-- being handed the piece. Without a cost the best strategy is to spam it and
-- every record converges on "who tapped hint fastest". The penalty is added
-- by the SERVER at finish time for the same reason the clock lives here: a
-- count the browser reports could simply be left at zero.
alter table public.game_sessions
  add column if not exists hint_count integer not null default 0;

-- One call per hint actually taken. Returns the running count so the screen
-- can show what it will cost.
create or replace function public.use_hint(p_session_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_n integer;
begin
  if auth.uid() is null then
    raise exception 'sign-in required';
  end if;
  update public.game_sessions
     set hint_count = hint_count + 1
   where id = p_session_id and user_id = auth.uid() and finished_at is null
  returning hint_count into v_n;
  if v_n is null then
    raise exception 'session not found';
  end if;
  return v_n;
end;
$fn$;

revoke execute on function public.use_hint(uuid) from public, anon;
grant execute on function public.use_hint(uuid) to authenticated;

-- finish_game, with the penalty folded in. Replaces section 6 above.
-- The per-piece time floor is checked against the RAW time (what the player
-- actually took); the penalty is then added to produce the recorded time.
-- Checking the floor after adding it would let a scripted run buy its way
-- past the check by taking hints.
create or replace function public.finish_game(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_s        public.game_sessions;
  v_raw      integer;
  v_elapsed  integer;
  v_floor    integer;
  v_penalty  integer;
  v_prev     integer;
  v_best     integer;
  v_rank     integer;
  v_total    integer;
  v_pb       boolean := false;
begin
  if auth.uid() is null then
    raise exception 'sign-in required';
  end if;

  select * into v_s from public.game_sessions
  where id = p_session_id and user_id = auth.uid();
  if v_s.id is null then
    raise exception 'session not found';
  end if;

  -- Seconds added per hint, from the admin options (CLAUDE.md 16).
  select coalesce((settings->>'gameHintPenaltySec')::integer, 30) into v_penalty
  from public.site_settings where id = true;
  v_penalty := coalesce(v_penalty, 30);

  if v_s.finished_at is not null then
    v_elapsed := v_s.elapsed_ms;              -- already closed: same answer again
  else
    v_raw := greatest(1, (extract(epoch from (now() - v_s.started_at)) * 1000)::integer);

    v_floor := v_s.target_pieces * 250;
    if v_raw < v_floor then
      raise exception 'implausible time';
    end if;

    v_elapsed := v_raw + (v_s.hint_count * v_penalty * 1000);

    update public.game_sessions
       set finished_at = now(), elapsed_ms = v_elapsed
     where id = v_s.id;
  end if;

  select elapsed_ms into v_prev from public.game_best_records
  where project_id = v_s.project_id and artwork_id = v_s.artwork_id and user_id = auth.uid();

  if v_prev is null or v_elapsed < v_prev then
    insert into public.game_best_records (project_id, artwork_id, user_id, elapsed_ms, completed_at)
    values (v_s.project_id, v_s.artwork_id, auth.uid(), v_elapsed, now())
    on conflict (project_id, artwork_id, user_id) do update
      set elapsed_ms = excluded.elapsed_ms, completed_at = excluded.completed_at;
    v_pb := v_prev is not null;
  end if;

  select elapsed_ms into v_best from public.game_best_records
  where project_id = v_s.project_id and artwork_id = v_s.artwork_id and user_id = auth.uid();

  select count(*)::integer + 1 into v_rank
  from public.game_best_records r
  where r.project_id = v_s.project_id and r.artwork_id = v_s.artwork_id
    and (r.elapsed_ms, r.completed_at, r.user_id) <
        (select b.elapsed_ms, b.completed_at, b.user_id from public.game_best_records b
         where b.project_id = v_s.project_id and b.artwork_id = v_s.artwork_id and b.user_id = auth.uid());

  select count(*)::integer into v_total
  from public.game_best_records
  where project_id = v_s.project_id and artwork_id = v_s.artwork_id;

  return jsonb_build_object(
    'elapsed_ms',    v_elapsed,
    'hints',         v_s.hint_count,
    'penalty_ms',    v_s.hint_count * v_penalty * 1000,
    'best_ms',       v_best,
    'personal_best', v_pb,
    'rank',          v_rank,
    'players',       v_total,
    'first_record',  v_total = 1 and v_rank = 1
  );
end;
$fn$;

revoke execute on function public.finish_game(uuid) from public, anon;
grant execute on function public.finish_game(uuid) to authenticated;

-- ── 9. game_top_players: the site-wide podium ───────────────────────────
-- Added 2026-09-13 for the top of the game page. Re-running this whole file
-- is safe (everything in it is idempotent).
--
-- Ranked by medals, not by time: a time only means anything against the same
-- artwork, so "the fastest player on the site" does not exist. Gold first,
-- then silver, then bronze, then total records — and user_id last, so two
-- players with identical medals never trade places between two reads.
-- Medals are current standings (the same definition game_medal_counts uses),
-- so losing a first place here costs the gold, exactly as the per-artwork
-- leaderboard already shows.
create or replace function public.game_top_players(p_limit integer default 3)
returns jsonb
language sql
stable
security definer
set search_path = public
as $fn$
  with ranked as (
    select r.user_id,
           row_number() over (
             partition by r.project_id, r.artwork_id
             order by r.elapsed_ms, r.completed_at, r.user_id
           ) as rn
    from public.game_best_records r
  ),
  tally as (
    select user_id,
           count(*) filter (where rn = 1) as gold,
           count(*) filter (where rn = 2) as silver,
           count(*) filter (where rn = 3) as bronze,
           count(*) as records
    from ranked
    group by user_id
  )
  select coalesce(
    jsonb_agg(to_jsonb(t) order by t.gold desc, t.silver desc, t.bronze desc, t.records desc, t.user_id),
    '[]'::jsonb)
  from (
    select t.user_id,
           p.username,
           p.avatar_url,
           t.gold::integer   as gold,
           t.silver::integer as silver,
           t.bronze::integer as bronze,
           t.records::integer as records
    from tally t
    left join public.profiles p on p.id = t.user_id
    where t.gold + t.silver + t.bronze > 0
    order by t.gold desc, t.silver desc, t.bronze desc, t.records desc, t.user_id
    limit greatest(1, least(coalesce(p_limit, 3), 20))
  ) t;
$fn$;

-- Public: the per-artwork leaderboards are already public, and this is the
-- same information added up.
revoke execute on function public.game_top_players(integer) from public;
grant execute on function public.game_top_players(integer) to anon, authenticated;

-- ── 10. game_medal_artworks: which artworks a player holds a medal on ────
-- Added 2026-09-13 for the profile page. Re-running this whole file is safe.
--
-- game_medal_counts says how many; this says which. Same ranking definition
-- as everywhere else (elapsed → completed_at → user_id), so a medal shown
-- here is the same medal the artwork's own leaderboard shows, and it
-- disappears the moment someone beats the time.
--
-- The artwork columns are joined in rather than left to a second request:
-- they are public rows either way, and a profile should not need two round
-- trips to draw one strip.
create or replace function public.game_medal_artworks(p_user_id uuid, p_limit integer default 24)
returns jsonb
language sql
stable
security definer
set search_path = public
as $fn$
  with ranked as (
    select r.user_id, r.project_id, r.artwork_id, r.elapsed_ms,
           row_number() over (
             partition by r.project_id, r.artwork_id
             order by r.elapsed_ms, r.completed_at, r.user_id
           ) as rn
    from public.game_best_records r
  )
  select coalesce(
    jsonb_agg(to_jsonb(t) order by t.rank, t.elapsed_ms, t.artwork_id),
    '[]'::jsonb)
  from (
    select k.artwork_id,
           k.project_id,
           k.rn::integer       as rank,
           k.elapsed_ms::bigint as elapsed_ms,
           s.art_title,
           s.author_id,
           s.author_name,
           s.thumb_url,
           s.image_url
    from ranked k
    join public.mosaic_submissions s on s.id = k.artwork_id
    where k.user_id = p_user_id and k.rn <= 3
    order by k.rn, k.elapsed_ms, k.artwork_id
    limit greatest(1, least(coalesce(p_limit, 24), 60))
  ) t;
$fn$;

-- Public: a profile page is public, and so is every leaderboard this reads.
revoke execute on function public.game_medal_artworks(uuid, integer) from public;
grant execute on function public.game_medal_artworks(uuid, integer) to anon, authenticated;

-- ── 11. game_artwork_medals: who holds the medals on ONE artwork ─────────
-- Added 2026-09-13 for the artwork lightbox. Re-running this file is safe.
--
-- game_artwork_stats answers the same question for a whole campaign at once
-- (the game list needs every artwork); the lightbox opens one artwork from
-- any page, so it needs the single-artwork version rather than pulling a
-- campaign-wide table to read three rows out of it.
--
-- Ranked within (project, artwork) like everywhere else, so the names here
-- are the same three the game list and the profile strip show.
create or replace function public.game_artwork_medals(p_artwork_id bigint)
returns jsonb
language sql
stable
security definer
set search_path = public
as $fn$
  with ranked as (
    select r.project_id, r.artwork_id, r.user_id, r.elapsed_ms,
           row_number() over (
             partition by r.project_id, r.artwork_id
             order by r.elapsed_ms, r.completed_at, r.user_id
           ) as rn
    from public.game_best_records r
    where r.artwork_id = p_artwork_id
  )
  select coalesce(
    jsonb_agg(to_jsonb(t) order by t.rank, t.elapsed_ms),
    '[]'::jsonb)
  from (
    select k.rn::integer        as rank,
           k.user_id,
           k.elapsed_ms::bigint as elapsed_ms,
           p.username,
           p.avatar_url
    from ranked k
    left join public.profiles p on p.id = k.user_id
    where k.rn <= 3
    order by k.rn, k.elapsed_ms
    limit 3
  ) t;
$fn$;

-- Public: the same standings the game page already shows to everyone.
revoke execute on function public.game_artwork_medals(bigint) from public;
grant execute on function public.game_artwork_medals(bigint) to anon, authenticated;
