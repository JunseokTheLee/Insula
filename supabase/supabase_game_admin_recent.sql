-- Run this once in the Supabase SQL editor (Project → SQL Editor → New query).
-- Run AFTER supabase_game.sql, supabase_game_medal_rules.sql and supabase_pixel_levels.sql.
-- Idempotent — safe to run again.
--
-- "Recent games" moved from the find-the-piece game page to the admin page
-- (2026-10-03, user decision).
--
-- 1. admin_recent_game_runs(): every finished find-the-piece run AND every
--    colour-by-number completion, newest first, across all campaigns — for the admin "Game records" tab. Unlike the old public
--    list it ignores the gameRecentRunsEnabled option and DOES show runs by
--    ranking-excluded accounts (flagged), since spotting those is what an
--    admin looks for. Read-only.
-- 2. game_recent_runs() is no longer callable by visitors: the page that
--    used it is gone, and a public RPC would keep listing who played what.
--    (The function stays; re-running supabase_game_medal_rules.sql grants
--    it again — run this file after it.)

-- ── 1. admin list ───────────────────────────────────────────────────────
-- Both games in one list (2026-10-03, second request): find-the-piece runs
-- (game_sessions, finished) and colour-by-number completions (pixel_progress
-- rows with completed_at — one per player, artwork and level; colouring
-- keeps no play time, so those rows carry the level and the cells instead).
-- Needs supabase_pixel_levels.sql for pixel_progress.level.
create or replace function public.admin_recent_game_runs(p_limit integer default 50, p_offset integer default 0)
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
  select coalesce(jsonb_agg(to_jsonb(t) order by t.finished_at desc, t.run_id), '[]'::jsonb)
  into v_out
  from (
    select u.*, p.username, p.avatar_url, coalesce(p.ranking_excluded, false) as ranking_excluded,
           a.art_title, a.thumb_url, a.image_url
    from (
      select 'find'::text as game, s.id::text as run_id, s.user_id, s.artwork_id, s.finished_at,
             s.project_id, mp.title as campaign_title,
             s.target_pieces, s.elapsed_ms, s.hint_count,
             null::integer as level, null::integer as cells,
             (b.elapsed_ms is not null and b.elapsed_ms = s.elapsed_ms) as is_best,
             (b.voided_at is not null) as best_voided
      from public.game_sessions s
      left join public.mosaic_projects mp on mp.id = s.project_id
      left join public.game_best_records b
        on b.project_id = s.project_id and b.artwork_id = s.artwork_id and b.user_id = s.user_id
      where s.finished_at is not null
      union all
      select 'color'::text, pp.user_id::text || ':' || pp.artwork_id || ':' || pp.level, pp.user_id, pp.artwork_id, pp.completed_at,
             null::bigint, null::text,
             null::integer, null::integer, null::integer,
             pp.level, pp.filled_count,
             false, false
      from public.pixel_progress pp
      where pp.completed_at is not null
    ) u
    left join public.profiles p on p.id = u.user_id
    left join public.mosaic_submissions a on a.id = u.artwork_id
    order by u.finished_at desc, u.run_id
    limit greatest(1, least(coalesce(p_limit, 50), 200))
    offset greatest(0, coalesce(p_offset, 0))
  ) t;
  return v_out;
end;
$fn$;

revoke execute on function public.admin_recent_game_runs(integer, integer) from public;
grant execute on function public.admin_recent_game_runs(integer, integer) to authenticated; -- gated to admins inside

-- ── 2. the public list is closed ────────────────────────────────────────
do $$
begin
  if to_regprocedure('public.game_recent_runs(bigint, integer, integer, bigint)') is not null then
    revoke execute on function public.game_recent_runs(bigint, integer, integer, bigint) from public, anon, authenticated;
  end if;
end;
$$;
