-- Run this once in the Supabase SQL editor (Project → SQL Editor → New query).
-- Run AFTER supabase_mosaic_pieces.sql (parent_id), supabase_site_settings.sql
-- (the pixel* options), supabase_notifications.sql, and AFTER
-- supabase_game.sql / supabase_admin_broadcast.sql — §5 below re-defines the
-- notifications type check that those two files also own, and whichever file
-- runs LAST wins. This file's list is the superset, so running it last is
-- always safe; if either of the others is re-run afterwards, run this one
-- again or completion notifications start failing.
--
-- Colour-by-number game (/{lang}/coloring, js/coloring.js, js/pixel-board.js):
-- an artwork is reduced to a small numbered grid (default 48 cells on the long
-- side, 16 colours) and players fill the cells by number. No timer, no ranking
-- — what is kept is each player's progress, who finished which artwork, and a
-- one-time notification to the artist.
--
-- WHERE THE BOARD IS MADE
-- In the browser (canvas + median cut, 1–4 ms), by the artist right after an
-- upload or by an admin for older artworks, and stored here so everyone paints
-- the SAME board — canvas downscaling differs slightly between devices, and a
-- board started on a PC must still have the right numbers on a phone.
--
-- WHAT THE SERVER CAN AND CANNOT VERIFY
-- save_pixel_progress counts the bits the client sends and decides completion
-- from that count; it cannot know whether the cells were really painted (a
-- static site has no trusted game server). That is why there is no ranking
-- and nothing to win — a forged completion earns a notification to the
-- artist and a card on the forger's own profile, nothing more.

-- ── 1. per-artwork opt-out ────────────────────────────────────────────────
-- Allowed by default (policy text in privacy/disclaimer); an artist can take
-- one artwork out of the game from the artwork editor. The column is written
-- through the existing "author edits own artwork" update policy, which needs
-- a column-level grant like the other editable fields
-- (supabase_mosaic_edit_art_details.sql).
alter table public.mosaic_submissions
  add column if not exists coloring_opt_out boolean not null default false;
grant update (coloring_opt_out) on public.mosaic_submissions to authenticated;

-- ── 2. pixel_boards ──────────────────────────────────────────────────────
create table if not exists public.pixel_boards (
  artwork_id  bigint primary key references public.mosaic_submissions(id) on delete cascade,
  w           integer not null check (w between 4 and 128),
  h           integer not null check (h between 4 and 128),
  -- [[r,g,b], …] light to dark; a cell's byte is an index into this.
  palette     jsonb not null,
  -- base64 of w*h bytes, one per cell; 255 = not part of the artwork.
  cells       text not null,
  colors      integer not null check (colors between 1 and 64),
  -- Paintable cells (everything but 255) — what "complete" is measured against.
  total       integer not null check (total > 0),
  -- Bumped by every rebuild; progress made on an older version is discarded.
  version     integer not null default 1,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.pixel_boards enable row level security;

drop policy if exists "Anyone can read pixel boards" on public.pixel_boards;
create policy "Anyone can read pixel boards"
  on public.pixel_boards for select
  using (true);

-- Written only through set_pixel_board. Supabase grants ALL on new public
-- tables to anon/authenticated by default, so revoke first (CLAUDE.md §6).
revoke all on public.pixel_boards from anon, authenticated;
grant select on public.pixel_boards to anon, authenticated;

-- ── 3. set_pixel_board ───────────────────────────────────────────────────
-- Artist of the artwork or an admin. Validates the shape the client claims
-- (sizes, palette length, every cell index inside the palette) and counts the
-- paintable cells itself — the client's numbers are not trusted for the one
-- value completion depends on. Re-running for an artwork replaces the board
-- and bumps its version.
create or replace function public.set_pixel_board(
  p_artwork_id bigint, p_w integer, p_h integer, p_palette jsonb, p_cells text, p_colors integer
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

  insert into public.pixel_boards (artwork_id, w, h, palette, cells, colors, total)
  values (p_artwork_id, p_w, p_h, p_palette, p_cells, p_colors, v_total)
  on conflict (artwork_id) do update
    set w = excluded.w, h = excluded.h, palette = excluded.palette, cells = excluded.cells,
        colors = excluded.colors, total = excluded.total,
        version = public.pixel_boards.version + 1, updated_at = now()
  returning version into v_ver;
  return v_ver;
end;
$$;

revoke execute on function public.set_pixel_board(bigint, integer, integer, jsonb, text, integer) from public, anon;
grant execute on function public.set_pixel_board(bigint, integer, integer, jsonb, text, integer) to authenticated;

-- ── 4. pixel_progress ────────────────────────────────────────────────────
-- One row per (player, artwork): a bitset of correctly painted cells, its
-- count, and when the board was finished. Anonymous players never get a row
-- (their progress stays in the browser).
create table if not exists public.pixel_progress (
  user_id       uuid not null references auth.users(id) on delete cascade,
  artwork_id    bigint not null references public.mosaic_submissions(id) on delete cascade,
  board_version integer not null,
  filled        text not null default '',
  filled_count  integer not null default 0,
  completed_at  timestamptz,
  updated_at    timestamptz not null default now(),
  primary key (user_id, artwork_id)
);

create index if not exists pixel_progress_artwork_done_idx
  on public.pixel_progress (artwork_id) where completed_at is not null;

alter table public.pixel_progress enable row level security;

drop policy if exists "Players read their own pixel progress" on public.pixel_progress;
create policy "Players read their own pixel progress"
  on public.pixel_progress for select
  using (user_id = auth.uid());

-- Written only by save_pixel_progress (it stamps completed_at and sends the
-- artist's notification — a direct insert could do both freely).
revoke all on public.pixel_progress from anon, authenticated;
grant select on public.pixel_progress to authenticated;

-- ── 4b. save_pixel_progress ──────────────────────────────────────────────
-- p_filled: base64 of ceil(w*h/8) bytes, bit i = cell i painted correctly.
-- Returns {filled, total, completed, first_completion, completions}.
create or replace function public.save_pixel_progress(p_artwork_id bigint, p_filled text)
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
  v_enabled     boolean;
  v_notify      boolean;
  v_author      uuid;
  v_title       text;
  v_completions integer;
begin
  if v_uid is null then
    raise exception 'sign-in required';
  end if;
  -- The site options, enforced here as well as on screen (the publishable
  -- key can call this directly).
  select coalesce((settings->>'pixelGameEnabled')::boolean, true),
         coalesce((settings->>'pixelNotifyArtist')::boolean, true)
    into v_enabled, v_notify
  from public.site_settings where id = true;
  if v_enabled is false then
    raise exception 'coloring game disabled';
  end if;
  select * into v_board from public.pixel_boards where artwork_id = p_artwork_id;
  if not found then
    raise exception 'artwork % has no board', p_artwork_id;
  end if;
  v_bits := decode(coalesce(p_filled, ''), 'base64');
  if octet_length(v_bits) <> ceil((v_board.w * v_board.h)::numeric / 8)::integer then
    raise exception 'progress bitset has the wrong size';
  end if;
  -- Bits set on padding cells (or beyond the board) must not count.
  v_count := least(bit_count(v_bits)::integer, v_board.total);
  v_completed := v_count >= v_board.total;

  select * into v_prev from public.pixel_progress where user_id = v_uid and artwork_id = p_artwork_id;
  if found and v_prev.board_version = v_board.version then
    v_first := v_completed and v_prev.completed_at is null;
    update public.pixel_progress
       set filled = p_filled, filled_count = v_count,
           completed_at = coalesce(v_prev.completed_at, case when v_completed then now() end),
           updated_at = now()
     where user_id = v_uid and artwork_id = p_artwork_id;
  else
    -- New, or made on an older board: start over on this version.
    v_first := v_completed;
    insert into public.pixel_progress (user_id, artwork_id, board_version, filled, filled_count, completed_at, updated_at)
    values (v_uid, p_artwork_id, v_board.version, p_filled, v_count, case when v_completed then now() end, now())
    on conflict (user_id, artwork_id) do update
      set board_version = excluded.board_version, filled = excluded.filled, filled_count = excluded.filled_count,
          completed_at = excluded.completed_at, updated_at = now();
  end if;

  -- Tell the artist once per (player, artwork) — the partial unique index in
  -- §5 makes a second completion a no-op. Never for the artist's own board.
  if v_first and v_notify then
    select author_id, art_title into v_author, v_title from public.mosaic_submissions where id = p_artwork_id;
    if v_author is not null and v_author <> v_uid then
      insert into public.notifications (recipient_id, actor_id, type, submission_id, preview)
      values (v_author, v_uid, 'pixel_complete', p_artwork_id, v_title)
      on conflict do nothing;
    end if;
  end if;

  select count(*)::integer into v_completions
  from public.pixel_progress where artwork_id = p_artwork_id and completed_at is not null;

  return jsonb_build_object(
    'filled', v_count, 'total', v_board.total, 'completed', v_completed,
    'first_completion', v_first, 'completions', v_completions
  );
end;
$$;

revoke execute on function public.save_pixel_progress(bigint, text) from public, anon;
grant execute on function public.save_pixel_progress(bigint, text) to authenticated;

-- ── 5. notifications: the 'pixel_complete' type ──────────────────────────
-- Same drop-by-shape dance as supabase_game.sql §12a: the constraint's name
-- differs between databases, so it is found by its definition.
do $mig$
declare
  v_name text;
begin
  for v_name in
    select conname from pg_constraint
    where conrelid = 'public.notifications'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%submission_like%'
  loop
    execute format('alter table public.notifications drop constraint %I', v_name);
  end loop;
end
$mig$;

alter table public.notifications add constraint notifications_type_check
  check (type in (
    'submission_like', 'submission_comment', 'submission_reply', 'follow',
    'announcement', 'medal_changed', 'pixel_complete'
  ));

-- One completion notification per (artist, player, artwork), ever.
create unique index if not exists notifications_pixel_complete_uniq
  on public.notifications (recipient_id, actor_id, submission_id)
  where type = 'pixel_complete';

-- ── 6. read helpers ──────────────────────────────────────────────────────
-- How many players finished each of these artworks (list cards, lightbox).
create or replace function public.pixel_completion_counts(p_ids bigint[])
returns table (artwork_id bigint, completions integer)
language sql
stable
security definer
set search_path = public
as $$
  select p.artwork_id, count(*)::integer
  from public.pixel_progress p
  where p.artwork_id = any(p_ids) and p.completed_at is not null
  group by p.artwork_id;
$$;
revoke execute on function public.pixel_completion_counts(bigint[]) from public;
grant execute on function public.pixel_completion_counts(bigint[]) to anon, authenticated;

-- The artworks one player has finished, newest first — the "coloured
-- artworks" strip on a profile. Public, like the medal strip: it names
-- artworks, not anything private.
create or replace function public.pixel_user_completions(p_user_id uuid, p_limit integer default 24)
returns table (
  artwork_id bigint, art_title text, author_name text, thumb_url text, image_url text, completed_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select s.id, s.art_title, s.author_name, s.thumb_url, s.image_url, p.completed_at
  from public.pixel_progress p
  join public.mosaic_submissions s on s.id = p.artwork_id
  where p.user_id = p_user_id and p.completed_at is not null
  order by p.completed_at desc
  limit greatest(1, least(coalesce(p_limit, 24), 100));
$$;
revoke execute on function public.pixel_user_completions(uuid, integer) from public;
grant execute on function public.pixel_user_completions(uuid, integer) to anon, authenticated;
