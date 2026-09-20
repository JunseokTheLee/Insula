-- Run this once in the Supabase SQL editor (Project → SQL Editor → New query).
-- Run AFTER supabase_game.sql (ALL of it — this file re-defines seven of its
-- functions), supabase_admin_moderation.sql (admin_log_action) and
-- supabase_site_settings.sql (the gameMedalMinPlayers / gameRecentRuns*
-- options). IF supabase_game.sql IS EVER RE-RUN, RUN THIS FILE AGAIN AFTERWARDS
-- — its function bodies would otherwise overwrite the rules below and medals
-- would go back to being awarded to whoever played alone.
--
-- Medal rules for the find-the-piece game (2026-09-20).
--
-- WHY: on 2026-09-20 one player held 23 of 32 medals, 17 of them on artworks
-- nobody else had ever played — first place by default. Medals are standings,
-- and a standing of one is not a standing. Three rules, none of which deletes
-- a record:
--
--   1. A medal needs competition: the top three on an artwork count as medals
--      only once that artwork has at least N recorders (site option
--      gameMedalMinPlayers, default 3). Below that the times are still listed,
--      just without medals.
--   2. An admin can take an account out of the rankings altogether
--      (profiles.ranking_excluded) — for the site's own test accounts. Its runs
--      are still recorded and still show on its own profile as personal times,
--      but not in the hall of fame, the per-artwork podium, the medal counts
--      or the recent-games list.
--   3. An admin can void one record (game_best_records.voided_at). The row
--      stays, the rankings ignore it, and it can be restored. A new personal
--      best by the same player replaces a voided record and clears the void —
--      a void is a judgement on one run, not on the player (rule 2 is for
--      that).
--
-- Also here: game_recent_runs, the public "recent games" list for the game
-- page (finished runs only, newest first), and the admin RPCs behind the
-- Members → Ranking exclusion section and the Game records tab.

-- ── 1. columns ───────────────────────────────────────────────────────────
alter table public.profiles
  add column if not exists ranking_excluded boolean not null default false;
-- Not in the column-level update grant (supabase_mosaic.sql §1), so a user
-- cannot flip it on themselves; readable like the rest of the profile.

alter table public.game_best_records add column if not exists voided_at timestamptz;
alter table public.game_best_records add column if not exists voided_by uuid references auth.users(id) on delete set null;
alter table public.game_best_records add column if not exists void_note text;

-- The recent-games list reads finished sessions newest first.
create index if not exists game_sessions_recent_idx
  on public.game_sessions (project_id, finished_at desc)
  where finished_at is not null;

-- ── 2. the minimum-recorders option, read the same way everywhere ───────
create or replace function public.game_medal_min_players()
returns integer
language sql
stable
security definer
set search_path = public
as $fn$
  select greatest(1, coalesce(
    (select (settings->>'gameMedalMinPlayers')::integer from public.site_settings where id = true), 3));
$fn$;
revoke execute on function public.game_medal_min_players() from public;
grant execute on function public.game_medal_min_players() to anon, authenticated;

-- ── 3. game_artwork_stats: per-artwork top times + the caller's, with
--       `players` and whether the top three are medals ───────────────────
create or replace function public.game_artwork_stats(p_project_id bigint)
returns jsonb
language sql
stable
security definer
set search_path = public
as $fn$
  with eligible as (
    select r.artwork_id, r.user_id, r.elapsed_ms, r.completed_at
    from public.game_best_records r
    where r.project_id = p_project_id
      and r.voided_at is null
      and not exists (select 1 from public.profiles p where p.id = r.user_id and p.ranking_excluded)
  ),
  ranked as (
    select e.*,
           row_number() over (partition by e.artwork_id order by e.elapsed_ms, e.completed_at, e.user_id) as rn,
           count(*) over (partition by e.artwork_id) as players
    from eligible e
  ),
  top3 as (
    select k.artwork_id,
           jsonb_agg(jsonb_build_object('name', coalesce(p.username, p.name, ''), 'ms', k.elapsed_ms) order by k.rn) as rows
    from ranked k
    left join public.profiles p on p.id = k.user_id
    where k.rn <= 3
    group by k.artwork_id
  ),
  -- The caller's own best comes from all their live records, ranked only
  -- when eligible: an excluded account still sees its times on the cards,
  -- just without a rank.
  mine as (
    select r.artwork_id, r.elapsed_ms, k.rn
    from public.game_best_records r
    left join ranked k on k.artwork_id = r.artwork_id and k.user_id = r.user_id
    where auth.uid() is not null and r.user_id = auth.uid()
      and r.project_id = p_project_id and r.voided_at is null
  ),
  per as (
    select artwork_id, max(players) as players from ranked group by artwork_id
    union all
    select m.artwork_id, 0 from mine m
    where not exists (select 1 from ranked k where k.artwork_id = m.artwork_id)
  )
  select coalesce(jsonb_object_agg(a.artwork_id::text, jsonb_build_object(
           'top',       coalesce(t.rows, '[]'::jsonb),
           'mine_ms',   m.elapsed_ms,
           'mine_rank', m.rn,
           'players',   a.players,
           'medals',    a.players >= public.game_medal_min_players()
         )), '{}'::jsonb)
  from per a
  left join top3 t on t.artwork_id = a.artwork_id
  left join mine m on m.artwork_id = a.artwork_id;
$fn$;
revoke execute on function public.game_artwork_stats(bigint) from public;
grant execute on function public.game_artwork_stats(bigint) to anon, authenticated;

-- ── 4. game_medal_counts: a player's medals under the rules ─────────────
create or replace function public.game_medal_counts(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $fn$
  with eligible as (
    select r.project_id, r.artwork_id, r.user_id, r.elapsed_ms, r.completed_at
    from public.game_best_records r
    where r.voided_at is null
      and not exists (select 1 from public.profiles p where p.id = r.user_id and p.ranking_excluded)
  ),
  ranked as (
    select e.user_id,
           row_number() over (partition by e.project_id, e.artwork_id order by e.elapsed_ms, e.completed_at, e.user_id) as rn,
           count(*) over (partition by e.project_id, e.artwork_id) as players
    from eligible e
  )
  select jsonb_build_object(
    'gold',    count(*) filter (where rn = 1 and players >= public.game_medal_min_players()),
    'silver',  count(*) filter (where rn = 2 and players >= public.game_medal_min_players()),
    'bronze',  count(*) filter (where rn = 3 and players >= public.game_medal_min_players()),
    'records', (select count(*) from public.game_best_records b where b.user_id = p_user_id and b.voided_at is null)
  )
  from ranked
  where user_id = p_user_id;
$fn$;
revoke execute on function public.game_medal_counts(uuid) from public;
grant execute on function public.game_medal_counts(uuid) to anon, authenticated;

-- ── 5. game_top_players: the site-wide podium ───────────────────────────
create or replace function public.game_top_players(p_limit integer default 3)
returns jsonb
language sql
stable
security definer
set search_path = public
as $fn$
  with eligible as (
    select r.project_id, r.artwork_id, r.user_id, r.elapsed_ms, r.completed_at
    from public.game_best_records r
    where r.voided_at is null
      and not exists (select 1 from public.profiles p where p.id = r.user_id and p.ranking_excluded)
  ),
  ranked as (
    select e.user_id,
           row_number() over (partition by e.project_id, e.artwork_id order by e.elapsed_ms, e.completed_at, e.user_id) as rn,
           count(*) over (partition by e.project_id, e.artwork_id) as players
    from eligible e
  ),
  tally as (
    select user_id,
           count(*) filter (where rn = 1 and players >= public.game_medal_min_players()) as gold,
           count(*) filter (where rn = 2 and players >= public.game_medal_min_players()) as silver,
           count(*) filter (where rn = 3 and players >= public.game_medal_min_players()) as bronze,
           count(*) as records
    from ranked
    group by user_id
  )
  select coalesce(
    jsonb_agg(to_jsonb(t) order by t.gold desc, t.silver desc, t.bronze desc, t.records desc, t.user_id),
    '[]'::jsonb)
  from (
    select t.user_id, p.username, p.avatar_url,
           t.gold::integer as gold, t.silver::integer as silver, t.bronze::integer as bronze, t.records::integer as records
    from tally t
    left join public.profiles p on p.id = t.user_id
    where t.gold + t.silver + t.bronze > 0
    order by t.gold desc, t.silver desc, t.bronze desc, t.records desc, t.user_id
    limit greatest(1, least(coalesce(p_limit, 3), 20))
  ) t;
$fn$;
revoke execute on function public.game_top_players(integer) from public;
grant execute on function public.game_top_players(integer) to anon, authenticated;

-- ── 6. game_medal_artworks: which artworks a player holds a medal on ────
create or replace function public.game_medal_artworks(p_user_id uuid, p_limit integer default 24)
returns jsonb
language sql
stable
security definer
set search_path = public
as $fn$
  with eligible as (
    select r.project_id, r.artwork_id, r.user_id, r.elapsed_ms, r.completed_at
    from public.game_best_records r
    where r.voided_at is null
      and not exists (select 1 from public.profiles p where p.id = r.user_id and p.ranking_excluded)
  ),
  ranked as (
    select e.user_id, e.project_id, e.artwork_id, e.elapsed_ms,
           row_number() over (partition by e.project_id, e.artwork_id order by e.elapsed_ms, e.completed_at, e.user_id) as rn,
           count(*) over (partition by e.project_id, e.artwork_id) as players
    from eligible e
  )
  select coalesce(jsonb_agg(to_jsonb(t) order by t.rank, t.elapsed_ms, t.artwork_id), '[]'::jsonb)
  from (
    select k.artwork_id, k.project_id, k.rn::integer as rank, k.elapsed_ms::bigint as elapsed_ms,
           s.art_title, s.author_id, s.author_name, s.thumb_url, s.image_url
    from ranked k
    join public.mosaic_submissions s on s.id = k.artwork_id
    where k.user_id = p_user_id and k.rn <= 3 and k.players >= public.game_medal_min_players()
    order by k.rn, k.elapsed_ms, k.artwork_id
    limit greatest(1, least(coalesce(p_limit, 24), 60))
  ) t;
$fn$;
revoke execute on function public.game_medal_artworks(uuid, integer) from public;
grant execute on function public.game_medal_artworks(uuid, integer) to anon, authenticated;

-- ── 7. game_artwork_medals: who holds the medals on ONE artwork ─────────
-- Empty while the artwork has too few recorders — the lightbox then shows
-- nothing, the same as an artwork nobody has played.
create or replace function public.game_artwork_medals(p_artwork_id bigint)
returns jsonb
language sql
stable
security definer
set search_path = public
as $fn$
  with eligible as (
    select r.project_id, r.artwork_id, r.user_id, r.elapsed_ms, r.completed_at
    from public.game_best_records r
    where r.artwork_id = p_artwork_id
      and r.voided_at is null
      and not exists (select 1 from public.profiles p where p.id = r.user_id and p.ranking_excluded)
  ),
  ranked as (
    select e.user_id, e.elapsed_ms,
           row_number() over (partition by e.project_id, e.artwork_id order by e.elapsed_ms, e.completed_at, e.user_id) as rn,
           count(*) over (partition by e.project_id, e.artwork_id) as players
    from eligible e
  )
  select coalesce(jsonb_agg(to_jsonb(t) order by t.rank, t.elapsed_ms), '[]'::jsonb)
  from (
    select k.rn::integer as rank, k.user_id, k.elapsed_ms::bigint as elapsed_ms, p.username, p.avatar_url
    from ranked k
    left join public.profiles p on p.id = k.user_id
    where k.rn <= 3 and k.players >= public.game_medal_min_players()
    order by k.rn, k.elapsed_ms
    limit 3
  ) t;
$fn$;
revoke execute on function public.game_artwork_medals(bigint) from public;
grant execute on function public.game_artwork_medals(bigint) to anon, authenticated;

-- ── 8. game_my_standing: where the caller sits overall ──────────────────
create or replace function public.game_my_standing()
returns jsonb
language sql
stable
security definer
set search_path = public
as $fn$
  with eligible as (
    select r.project_id, r.artwork_id, r.user_id, r.elapsed_ms, r.completed_at
    from public.game_best_records r
    where r.voided_at is null
      and not exists (select 1 from public.profiles p where p.id = r.user_id and p.ranking_excluded)
  ),
  ranked as (
    select e.user_id,
           row_number() over (partition by e.project_id, e.artwork_id order by e.elapsed_ms, e.completed_at, e.user_id) as rn,
           count(*) over (partition by e.project_id, e.artwork_id) as players
    from eligible e
  ),
  tally as (
    select user_id,
           count(*) filter (where rn = 1 and players >= public.game_medal_min_players()) as gold,
           count(*) filter (where rn = 2 and players >= public.game_medal_min_players()) as silver,
           count(*) filter (where rn = 3 and players >= public.game_medal_min_players()) as bronze,
           count(*) as records
    from ranked
    group by user_id
  ),
  placed as (
    select t.*,
           row_number() over (order by t.gold desc, t.silver desc, t.bronze desc, t.records desc, t.user_id) as rank,
           count(*) over () as players
    from tally t
  )
  select to_jsonb(x) from (
    select p.rank::integer as rank, p.players::integer as players,
           p.gold::integer as gold, p.silver::integer as silver, p.bronze::integer as bronze, p.records::integer as records
    from placed p
    where p.user_id = auth.uid()
  ) x;
$fn$;
revoke execute on function public.game_my_standing() from public, anon;
grant execute on function public.game_my_standing() to authenticated;

-- ── 9. finish_game: same as before, but ranks, "first record" and the
--       medal-change notifications follow the rules ───────────────────────
-- Extra keys in the result: `players` now counts eligible recorders, `medals`
-- says whether the top three on this artwork are medals right now, and
-- `excluded` tells an excluded account why it sees no rank.
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
  v_prev     integer;
  v_best     integer;
  v_rank     integer;
  v_total    integer;
  v_penalty  integer;
  v_min      integer;
  v_pb       boolean := false;
  v_improved boolean := false;
  v_excluded boolean := false;
  v_before   jsonb;
  v_uid      uuid;
  v_old_rank integer;
  v_new_rank integer;
begin
  if auth.uid() is null then
    raise exception 'sign-in required';
  end if;

  select * into v_s from public.game_sessions
  where id = p_session_id and user_id = auth.uid();
  if v_s.id is null then
    raise exception 'session not found';
  end if;

  select coalesce((settings->>'gameHintPenaltySec')::integer, 30) into v_penalty
  from public.site_settings where id = true;
  v_penalty := coalesce(v_penalty, 30);
  v_min := public.game_medal_min_players();
  select coalesce(p.ranking_excluded, false) into v_excluded from public.profiles p where p.id = auth.uid();
  v_excluded := coalesce(v_excluded, false);

  if v_s.finished_at is not null then
    v_elapsed := v_s.elapsed_ms;
  else
    v_raw := greatest(1, (extract(epoch from (now() - v_s.started_at)) * 1000)::integer);
    -- The floor is checked on the RAW time: the penalty is bookkeeping, not
    -- playing, and must not help an impossible run look possible.
    v_floor := v_s.target_pieces * 250;
    if v_raw < v_floor then
      raise exception 'implausible time';
    end if;
    v_elapsed := v_raw + (v_s.hint_count * v_penalty * 1000);
    update public.game_sessions
       set finished_at = now(), elapsed_ms = v_elapsed
     where id = v_s.id;
  end if;

  -- A voided record counts as no record: the next finish replaces it
  -- (otherwise a voided 3-second cheat would lock the player out of the
  -- artwork for good, since nothing honest beats it).
  select elapsed_ms into v_prev from public.game_best_records
  where project_id = v_s.project_id and artwork_id = v_s.artwork_id and user_id = auth.uid()
    and voided_at is null;

  if v_prev is null or v_elapsed < v_prev then
    -- The podium BEFORE the write, among eligible records; whoever moved down
    -- afterwards is the person to tell.
    select coalesce(jsonb_object_agg(t.user_id::text, t.rn), '{}'::jsonb) into v_before
    from (
      select r.user_id,
             row_number() over (order by r.elapsed_ms, r.completed_at, r.user_id) as rn
      from public.game_best_records r
      where r.project_id = v_s.project_id and r.artwork_id = v_s.artwork_id
        and r.voided_at is null
        and not exists (select 1 from public.profiles p where p.id = r.user_id and p.ranking_excluded)
    ) t
    where t.rn <= 3;

    -- Replaces a voided record and clears the void (rule 3 in the header).
    insert into public.game_best_records (project_id, artwork_id, user_id, elapsed_ms, completed_at)
    values (v_s.project_id, v_s.artwork_id, auth.uid(), v_elapsed, now())
    on conflict (project_id, artwork_id, user_id) do update
      set elapsed_ms = excluded.elapsed_ms, completed_at = excluded.completed_at,
          voided_at = null, voided_by = null, void_note = null;
    v_pb := v_prev is not null;
    v_improved := true;
  end if;

  select elapsed_ms into v_best from public.game_best_records
  where project_id = v_s.project_id and artwork_id = v_s.artwork_id and user_id = auth.uid();

  -- Eligible recorders on this artwork (the caller included unless excluded).
  select count(*)::integer into v_total
  from public.game_best_records r
  where r.project_id = v_s.project_id and r.artwork_id = v_s.artwork_id
    and r.voided_at is null
    and not exists (select 1 from public.profiles p where p.id = r.user_id and p.ranking_excluded);

  if v_excluded then
    v_rank := null;
  else
    select count(*)::integer + 1 into v_rank
    from public.game_best_records r
    where r.project_id = v_s.project_id and r.artwork_id = v_s.artwork_id
      and r.voided_at is null
      and not exists (select 1 from public.profiles p where p.id = r.user_id and p.ranking_excluded)
      and (r.elapsed_ms, r.completed_at, r.user_id) <
          (select b.elapsed_ms, b.completed_at, b.user_id from public.game_best_records b
           where b.project_id = v_s.project_id and b.artwork_id = v_s.artwork_id and b.user_id = auth.uid());
  end if;

  -- Medal-change notifications: only when medals exist here (enough
  -- recorders) and the caller is not an excluded account.
  if v_improved and not v_excluded and v_total >= v_min then
    for v_uid, v_old_rank in
      select key::uuid, value::integer from jsonb_each_text(v_before)
    loop
      if v_uid = auth.uid() then
        continue;
      end if;
      select count(*)::integer + 1 into v_new_rank
      from public.game_best_records r
      where r.project_id = v_s.project_id and r.artwork_id = v_s.artwork_id
        and r.voided_at is null
        and not exists (select 1 from public.profiles p where p.id = r.user_id and p.ranking_excluded)
        and (r.elapsed_ms, r.completed_at, r.user_id) <
            (select b.elapsed_ms, b.completed_at, b.user_id from public.game_best_records b
             where b.project_id = v_s.project_id and b.artwork_id = v_s.artwork_id and b.user_id = v_uid);
      if v_new_rank > v_old_rank then
        insert into public.notifications (recipient_id, actor_id, type, submission_id, preview)
        values (v_uid, auth.uid(), 'medal_changed', v_s.artwork_id, v_new_rank::text);
      end if;
    end loop;
  end if;

  return jsonb_build_object(
    'elapsed_ms',    v_elapsed,
    'hints',         v_s.hint_count,
    'penalty_ms',    v_s.hint_count * v_penalty * 1000,
    'best_ms',       v_best,
    'personal_best', v_pb,
    'rank',          v_rank,
    'players',       v_total,
    'medals',        (not v_excluded) and v_total >= v_min,
    'min_players',   v_min,
    'excluded',      v_excluded,
    'first_record',  (not v_excluded) and v_total = 1 and v_rank = 1
  );
end;
$fn$;
revoke execute on function public.finish_game(uuid) from public, anon;
grant execute on function public.finish_game(uuid) to authenticated;

-- ── 10. game_recent_runs: the public "recent games" list ────────────────
-- Finished runs only (a run that was quit has no finished_at), newest first,
-- for one campaign or one artwork of it. Excluded accounts do not appear.
-- `rank` and `medal` describe the player's CURRENT standing on that artwork,
-- `is_best` whether this very run is their personal best. Site option
-- gameRecentRunsEnabled turns the list off here as well as on screen.
create or replace function public.game_recent_runs(
  p_project_id bigint, p_limit integer default 10, p_offset integer default 0, p_artwork_id bigint default null
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $fn$
  with enabled as (
    select coalesce((select (settings->>'gameRecentRunsEnabled')::boolean
                     from public.site_settings where id = true), true) as v
  ),
  eligible as (
    select r.artwork_id, r.user_id, r.elapsed_ms, r.completed_at
    from public.game_best_records r
    where r.project_id = p_project_id
      and r.voided_at is null
      and not exists (select 1 from public.profiles p where p.id = r.user_id and p.ranking_excluded)
  ),
  ranked as (
    select e.artwork_id, e.user_id, e.elapsed_ms as best_ms,
           row_number() over (partition by e.artwork_id order by e.elapsed_ms, e.completed_at, e.user_id) as rn,
           count(*) over (partition by e.artwork_id) as players
    from eligible e
  ),
  runs as (
    select s.id, s.user_id, s.artwork_id, s.elapsed_ms, s.hint_count, s.finished_at
    from public.game_sessions s
    where (select v from enabled)
      and s.project_id = p_project_id
      and s.finished_at is not null
      and (p_artwork_id is null or s.artwork_id = p_artwork_id)
      and not exists (select 1 from public.profiles p where p.id = s.user_id and p.ranking_excluded)
    order by s.finished_at desc, s.id
    limit greatest(1, least(coalesce(p_limit, 10), 50))
    offset greatest(0, coalesce(p_offset, 0))
  )
  select coalesce(jsonb_agg((to_jsonb(t) - 'session_id') order by t.finished_at desc, t.session_id), '[]'::jsonb)
  from (
    select r.id as session_id, r.user_id, p.username, p.avatar_url,
           r.artwork_id, s.art_title, s.thumb_url, s.image_url,
           r.elapsed_ms, r.hint_count, r.finished_at,
           k.rn::integer as rank,
           (k.rn <= 3 and k.players >= public.game_medal_min_players()) as medal,
           (k.best_ms = r.elapsed_ms) as is_best
    from runs r
    left join public.profiles p on p.id = r.user_id
    left join public.mosaic_submissions s on s.id = r.artwork_id
    left join ranked k on k.artwork_id = r.artwork_id and k.user_id = r.user_id
  ) t;
$fn$;
revoke execute on function public.game_recent_runs(bigint, integer, integer, bigint) from public;
grant execute on function public.game_recent_runs(bigint, integer, integer, bigint) to anon, authenticated;

-- ── 11. admin: ranking exclusion ────────────────────────────────────────
create or replace function public.admin_set_ranking_excluded(p_user uuid, p_on boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_on boolean := coalesce(p_on, false);
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'admin only';
  end if;
  if p_user is null then
    raise exception 'user id required';
  end if;
  update public.profiles set ranking_excluded = v_on where id = p_user;
  if not found then
    raise exception 'profile % not found', p_user;
  end if;
  perform public.admin_log_action(
    case when v_on then 'ranking_exclude' else 'ranking_include' end,
    'profile',
    p_user::text,
    jsonb_build_object('username', (select coalesce(username, name) from public.profiles where id = p_user))
  );
  return v_on;
end;
$fn$;
revoke execute on function public.admin_set_ranking_excluded(uuid, boolean) from public, anon;
grant execute on function public.admin_set_ranking_excluded(uuid, boolean) to authenticated; -- gated to admins inside

-- ── 12. admin: void / restore one record ────────────────────────────────
create or replace function public.admin_void_game_record(
  p_project_id bigint, p_artwork_id bigint, p_user uuid, p_on boolean, p_note text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_on   boolean := coalesce(p_on, true);
  v_ms   integer;
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'admin only';
  end if;
  update public.game_best_records
     set voided_at = case when v_on then now() end,
         voided_by = case when v_on then auth.uid() end,
         void_note = case when v_on then left(p_note, 200) end
   where project_id = p_project_id and artwork_id = p_artwork_id and user_id = p_user
   returning elapsed_ms into v_ms;
  if not found then
    raise exception 'record not found';
  end if;
  perform public.admin_log_action(
    case when v_on then 'game_record_void' else 'game_record_restore' end,
    'game_record',
    p_project_id::text || ':' || p_artwork_id::text || ':' || p_user::text,
    jsonb_build_object(
      'username',   (select coalesce(username, name) from public.profiles where id = p_user),
      'art_title',  (select art_title from public.mosaic_submissions where id = p_artwork_id),
      'elapsed_ms', v_ms,
      'note',       left(p_note, 200))
  );
  return v_on;
end;
$fn$;
revoke execute on function public.admin_void_game_record(bigint, bigint, uuid, boolean, text) from public, anon;
grant execute on function public.admin_void_game_record(bigint, bigint, uuid, boolean, text) to authenticated; -- gated to admins inside

-- ── 13. admin: the records list ─────────────────────────────────────────
-- Best times (the rows medals come from), newest first, with who and what.
-- Admin-only: the same rows are public one artwork at a time, but a site-wide
-- list with usernames is a moderation view.
create or replace function public.admin_game_records(
  p_limit integer default 50, p_offset integer default 0, p_search text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_out jsonb;
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'admin only';
  end if;
  select coalesce(jsonb_agg(to_jsonb(t) order by t.completed_at desc), '[]'::jsonb) into v_out
  from (
    select r.project_id, r.artwork_id, r.user_id, r.elapsed_ms, r.completed_at, r.voided_at, r.void_note,
           p.username, p.avatar_url, coalesce(p.ranking_excluded, false) as ranking_excluded,
           s.art_title, s.author_id
    from public.game_best_records r
    left join public.profiles p on p.id = r.user_id
    left join public.mosaic_submissions s on s.id = r.artwork_id
    where p_search is null or btrim(p_search) = ''
       or p.username ilike '%' || btrim(p_search) || '%'
       or s.art_title ilike '%' || btrim(p_search) || '%'
    order by r.completed_at desc
    limit greatest(1, least(coalesce(p_limit, 50), 200))
    offset greatest(0, coalesce(p_offset, 0))
  ) t;
  return v_out;
end;
$fn$;
revoke execute on function public.admin_game_records(integer, integer, text) from public, anon;
grant execute on function public.admin_game_records(integer, integer, text) to authenticated; -- gated to admins inside
