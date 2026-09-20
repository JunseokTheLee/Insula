-- Run this once in the Supabase SQL editor (Project → SQL Editor → New query).
-- Run AFTER supabase_pixel_game.sql AND supabase_portfolios.sql (the latter
-- re-defines pixel_user_completions and the pixel_boards read policy; this
-- file leaves both alone and adds its own function). Idempotent.
--
-- Three difficulty levels per artwork for the colour-by-number game
-- (2026-09-20): easy / normal / hard = a smaller or larger board of the same
-- picture (24 / 40 / 64 cells on the long side by default — site options
-- pixelEasyGrid … pixelHardColors). A board row and a progress row now
-- belong to one (artwork, level); a player can finish the same artwork at
-- every level, and "completed" for the artwork means finished at any level.
--
-- The tables were empty in production when this ran (the game launched the
-- same day), so the primary-key change below moves no data; it is still
-- written to work on a filled table (existing rows become level 2, the old
-- default size).

-- ── 1. boards: one per (artwork, level) ─────────────────────────────────
alter table public.pixel_boards
  add column if not exists level smallint not null default 2;
alter table public.pixel_boards drop constraint if exists pixel_boards_level_check;
alter table public.pixel_boards add constraint pixel_boards_level_check check (level between 1 and 3);

do $mig$
declare
  v_name text;
begin
  -- The old single-column key (artwork_id) → (artwork_id, level).
  select conname into v_name
  from pg_constraint
  where conrelid = 'public.pixel_boards'::regclass and contype = 'p' and array_length(conkey, 1) = 1;
  if v_name is not null then
    execute format('alter table public.pixel_boards drop constraint %I', v_name);
    alter table public.pixel_boards add primary key (artwork_id, level);
  end if;
end
$mig$;

-- ── 2. progress: one per (player, artwork, level) ───────────────────────
alter table public.pixel_progress
  add column if not exists level smallint not null default 2;
alter table public.pixel_progress drop constraint if exists pixel_progress_level_check;
alter table public.pixel_progress add constraint pixel_progress_level_check check (level between 1 and 3);

do $mig$
declare
  v_name text;
begin
  select conname into v_name
  from pg_constraint
  where conrelid = 'public.pixel_progress'::regclass and contype = 'p' and array_length(conkey, 1) = 2;
  if v_name is not null then
    execute format('alter table public.pixel_progress drop constraint %I', v_name);
    alter table public.pixel_progress add primary key (user_id, artwork_id, level);
  end if;
end
$mig$;

-- ── 3. set_pixel_board with a level ─────────────────────────────────────
-- The old 6-argument form goes (nothing calls it any more; keeping both
-- would make an unnamed call ambiguous). Same checks as before.
drop function if exists public.set_pixel_board(bigint, integer, integer, jsonb, text, integer);

create or replace function public.set_pixel_board(
  p_artwork_id bigint, p_level integer, p_w integer, p_h integer, p_palette jsonb, p_cells text, p_colors integer
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_art   public.mosaic_submissions%rowtype;
  v_bytes bytea;
  v_len   integer;
  v_b     integer;
  v_total integer := 0;
  v_ver   integer;
  i       integer;
begin
  if auth.uid() is null then
    raise exception 'sign-in required';
  end if;
  if p_level is null or p_level < 1 or p_level > 3 then
    raise exception 'level must be 1, 2 or 3';
  end if;
  select * into v_art from public.mosaic_submissions where id = p_artwork_id;
  if not found then
    raise exception 'artwork % not found', p_artwork_id;
  end if;
  if v_art.parent_id is not null then
    raise exception 'a piece has no board of its own';
  end if;
  if v_art.author_id <> auth.uid()
     and not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then
    raise exception 'only the artist or an admin can make this board';
  end if;
  if coalesce(v_art.coloring_opt_out, false) then
    raise exception 'the artist has opted this artwork out of the coloring game';
  end if;
  if p_w is null or p_h is null or p_w < 4 or p_h < 4 or p_w > 128 or p_h > 128 or p_w * p_h > 16384 then
    raise exception 'board size out of range';
  end if;
  if p_colors is null or p_colors < 1 or p_colors > 64 then
    raise exception 'palette size out of range';
  end if;
  if p_palette is null or jsonb_typeof(p_palette) <> 'array' or jsonb_array_length(p_palette) <> p_colors then
    raise exception 'palette must be an array of % colours', p_colors;
  end if;
  v_bytes := decode(coalesce(p_cells, ''), 'base64');
  v_len := octet_length(v_bytes);
  if v_len <> p_w * p_h then
    raise exception 'cells must hold exactly % bytes, got %', p_w * p_h, v_len;
  end if;
  for i in 0 .. v_len - 1 loop
    v_b := get_byte(v_bytes, i);
    if v_b = 255 then
      continue;
    end if;
    if v_b >= p_colors then
      raise exception 'cell % points outside the palette', i;
    end if;
    v_total := v_total + 1;
  end loop;
  if v_total < 1 then
    raise exception 'board has no paintable cells';
  end if;

  insert into public.pixel_boards (artwork_id, level, w, h, palette, cells, colors, total)
  values (p_artwork_id, p_level, p_w, p_h, p_palette, p_cells, p_colors, v_total)
  on conflict (artwork_id, level) do update
    set w = excluded.w, h = excluded.h, palette = excluded.palette, cells = excluded.cells,
        colors = excluded.colors, total = excluded.total,
        version = public.pixel_boards.version + 1, updated_at = now()
  returning version into v_ver;
  return v_ver;
end;
$$;
revoke execute on function public.set_pixel_board(bigint, integer, integer, integer, jsonb, text, integer) from public, anon;
grant execute on function public.set_pixel_board(bigint, integer, integer, integer, jsonb, text, integer) to authenticated;

-- ── 4. save_pixel_progress with a level ─────────────────────────────────
-- Returns {filled, total, completed, first_completion, completions}.
-- `first_completion` = the first time this player finished this ARTWORK at
-- any level (the artist is told once per artwork — same unique index as
-- before); `completions` = how many different players finished it at any
-- level.
drop function if exists public.save_pixel_progress(bigint, text);

create or replace function public.save_pixel_progress(p_artwork_id bigint, p_level integer, p_filled text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid         uuid := auth.uid();
  v_board       public.pixel_boards%rowtype;
  v_prev        public.pixel_progress%rowtype;
  v_bits        bytea;
  v_count       integer;
  v_completed   boolean;
  v_first       boolean := false;
  v_had_any     boolean;
  v_enabled     boolean;
  v_notify      boolean;
  v_author      uuid;
  v_title       text;
  v_completions integer;
begin
  if v_uid is null then
    raise exception 'sign-in required';
  end if;
  if p_level is null or p_level < 1 or p_level > 3 then
    raise exception 'level must be 1, 2 or 3';
  end if;
  select coalesce((settings->>'pixelGameEnabled')::boolean, true),
         coalesce((settings->>'pixelNotifyArtist')::boolean, true)
    into v_enabled, v_notify
  from public.site_settings where id = true;
  if v_enabled is false then
    raise exception 'coloring game disabled';
  end if;
  select * into v_board from public.pixel_boards where artwork_id = p_artwork_id and level = p_level;
  if not found then
    raise exception 'artwork % has no level-% board', p_artwork_id, p_level;
  end if;
  v_bits := decode(coalesce(p_filled, ''), 'base64');
  if octet_length(v_bits) <> ceil((v_board.w * v_board.h)::numeric / 8)::integer then
    raise exception 'progress bitset has the wrong size';
  end if;
  v_count := least(bit_count(v_bits)::integer, v_board.total);
  v_completed := v_count >= v_board.total;

  -- Finished this artwork before, at any level?
  select exists (select 1 from public.pixel_progress
                 where user_id = v_uid and artwork_id = p_artwork_id and completed_at is not null)
    into v_had_any;

  select * into v_prev from public.pixel_progress
  where user_id = v_uid and artwork_id = p_artwork_id and level = p_level;
  if found and v_prev.board_version = v_board.version then
    update public.pixel_progress
       set filled = p_filled, filled_count = v_count,
           completed_at = coalesce(v_prev.completed_at, case when v_completed then now() end),
           updated_at = now()
     where user_id = v_uid and artwork_id = p_artwork_id and level = p_level;
  else
    insert into public.pixel_progress (user_id, artwork_id, level, board_version, filled, filled_count, completed_at, updated_at)
    values (v_uid, p_artwork_id, p_level, v_board.version, p_filled, v_count, case when v_completed then now() end, now())
    on conflict (user_id, artwork_id, level) do update
      set board_version = excluded.board_version, filled = excluded.filled, filled_count = excluded.filled_count,
          completed_at = excluded.completed_at, updated_at = now();
  end if;
  v_first := v_completed and not v_had_any;

  if v_first and v_notify then
    select author_id, art_title into v_author, v_title from public.mosaic_submissions where id = p_artwork_id;
    if v_author is not null and v_author <> v_uid then
      insert into public.notifications (recipient_id, actor_id, type, submission_id, preview)
      values (v_author, v_uid, 'pixel_complete', p_artwork_id, v_title)
      on conflict do nothing;
    end if;
  end if;

  select count(distinct user_id)::integer into v_completions
  from public.pixel_progress where artwork_id = p_artwork_id and completed_at is not null;

  return jsonb_build_object(
    'filled', v_count, 'total', v_board.total, 'completed', v_completed,
    'first_completion', v_first, 'completions', v_completions
  );
end;
$$;
revoke execute on function public.save_pixel_progress(bigint, integer, text) from public, anon;
grant execute on function public.save_pixel_progress(bigint, integer, text) to authenticated;

-- ── 5. read helpers ─────────────────────────────────────────────────────
-- Players who finished each artwork at any level (one per player).
create or replace function public.pixel_completion_counts(p_ids bigint[])
returns table (artwork_id bigint, completions integer)
language sql
stable
security definer
set search_path = public
as $$
  select p.artwork_id, count(distinct p.user_id)::integer
  from public.pixel_progress p
  where p.artwork_id = any(p_ids) and p.completed_at is not null
  group by p.artwork_id;
$$;
revoke execute on function public.pixel_completion_counts(bigint[]) from public;
grant execute on function public.pixel_completion_counts(bigint[]) to anon, authenticated;

-- One player's finished artworks with the HIGHEST level they finished each
-- at — the "coloured artworks" strip on a profile (replaces
-- pixel_user_completions there; that function is left as it is). Public
-- artworks only, like everything else that names an artwork by id.
create or replace function public.pixel_user_levels(p_user_id uuid, p_limit integer default 24)
returns table (
  artwork_id bigint, level integer, art_title text, author_name text, thumb_url text, image_url text, completed_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select s.id, max(p.level)::integer, s.art_title, s.author_name, s.thumb_url, s.image_url, max(p.completed_at)
  from public.pixel_progress p
  join public.mosaic_submissions s on s.id = p.artwork_id
  where p.user_id = p_user_id and p.completed_at is not null and s.is_public
  group by s.id, s.art_title, s.author_name, s.thumb_url, s.image_url
  order by max(p.completed_at) desc
  limit greatest(1, least(coalesce(p_limit, 24), 100));
$$;
revoke execute on function public.pixel_user_levels(uuid, integer) from public;
grant execute on function public.pixel_user_levels(uuid, integer) to anon, authenticated;
