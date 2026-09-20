-- Run this once in the Supabase SQL editor (Project → SQL Editor → New query).
-- Run AFTER supabase_mosaic_collections.sql, supabase_mosaic_collections_publish.sql,
-- supabase_mosaic_pieces.sql (match_pool_artworks, mosaic_stats), supabase_pixel_game.sql
-- (pixel_user_completions, pixel_boards) and supabase_game_medal_rules.sql
-- (game_recent_runs, game_medal_artworks) — this file re-defines one function
-- from each of the last three, so IF ANY OF THEM IS EVER RE-RUN, RUN THIS FILE
-- AGAIN AFTERWARDS. Idempotent; safe to re-run on its own at any time.
--
-- Artwork visibility + artist portfolios (2026-09-20).
--
-- 1. An artwork is PUBLIC (the default, and what every existing artwork
--    stays) or PRIVATE. A private artwork never enters a campaign mosaic —
--    the mosaic is public, so its pieces would be on show — and does not
--    appear in the home page, explore, the games, the sitemap or another
--    person's view of the artist's profile. It is readable by its artist, by
--    admins, and by anyone looking at a public portfolio the artist put it
--    in. That last case is the whole point of "private": work you show on
--    your own terms, in your own portfolio, without it being scattered
--    across the site.
--
--    What this does NOT do: hide the image FILE. The `artwork` bucket is
--    public and the browser needs plain URLs for it; someone who already has
--    the file URL can still open it. That is the same as an unlisted video —
--    good enough for "not on the site", not a vault (CLAUDE.md §7 explains
--    why a private bucket + signed URLs is a separate project).
--
-- 2. The former "mini-exhibitions" (mosaic_collections) become PORTFOLIOS:
--    an artist's own artworks only, in an order they choose, with a cover,
--    a layout for the viewer page, and a share card for links pasted into
--    social apps. Visibility has three steps, built on the two columns that
--    already existed: public (is_public, is_published — in the directory),
--    link only (is_public, not is_published — anyone with the link), and
--    private (not is_public — the owner only). The publish/end_date
--    lifecycle of supabase_mosaic_collections_publish.sql is retired: the
--    columns stay, the screens no longer use end_date.

-- ══════════════════════════════════════════════════════════════════════════
-- Part A — artwork visibility
-- ══════════════════════════════════════════════════════════════════════════

-- ── A1. the column ──────────────────────────────────────────────────────
alter table public.mosaic_submissions
  add column if not exists is_public boolean not null default true;

-- The artist may set it on upload and flip it later (the lightbox edit
-- dialog); everything the flip has to drag along happens in the trigger
-- below, so no RPC is needed and an admin's own update goes the same road.
grant insert (is_public), update (is_public) on public.mosaic_submissions to authenticated;

-- Private artworks are few; this keeps "my private ones" and the RLS check
-- below cheap without touching the common (public) path.
create index if not exists mosaic_submissions_private_idx
  on public.mosaic_submissions (author_id) where not is_public;

-- ── A2. pieces are as visible as their artwork ──────────────────────────
-- set_submission_pieces (supabase_mosaic_pieces.sql) copies the artwork's
-- columns into each piece row with an insert…select; rather than re-defining
-- that function, a BEFORE INSERT trigger copies the flag too. The value the
-- caller sends for a piece is ignored on purpose — a piece cannot be more
-- public than its artwork.
create or replace function public.mosaic_submissions_inherit_visibility()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if new.parent_id is not null then
    select s.is_public into new.is_public from public.mosaic_submissions s where s.id = new.parent_id;
    new.is_public := coalesce(new.is_public, true);
  end if;
  return new;
end;
$fn$;
drop trigger if exists mosaic_submissions_inherit_visibility on public.mosaic_submissions;
create trigger mosaic_submissions_inherit_visibility
  before insert on public.mosaic_submissions
  for each row execute function public.mosaic_submissions_inherit_visibility();

-- ── A3. flipping the flag ───────────────────────────────────────────────
-- Going private: the pieces follow, and every cell they hold is given back
-- (the same statements unmatch_submission uses — the mosaic_pixels trigger
-- of supabase_mosaic_pieces.sql then bumps the campaign's cells_changed_at
-- so other pooled pieces get a try at the reopened cells). Going public:
-- the pieces follow and are marked never-tried, so the next matching pass
-- places them first. Whole artworks placed before pieces existed are
-- released too.
create or replace function public.mosaic_submissions_visibility_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if new.parent_id is not null then
    return null; -- a piece follows its artwork; nothing fans out from it
  end if;

  update public.mosaic_submissions
     set is_public = new.is_public
   where parent_id = new.id and is_public is distinct from new.is_public;

  if new.is_public then
    update public.mosaic_submissions set match_tried_at = null
     where parent_id = new.id and pixel_id is null;
  else
    update public.mosaic_pixels
       set filled = false, submission_id = null, claimed_by = null, claimed_at = null
     where id in (select pixel_id from public.mosaic_submissions where parent_id = new.id and pixel_id is not null);
    update public.mosaic_submissions
       set project_id = null, pixel_id = null
     where parent_id = new.id and pixel_id is not null;
    if new.pixel_id is not null then
      update public.mosaic_pixels
         set filled = false, submission_id = null, claimed_by = null, claimed_at = null
       where id = new.pixel_id;
      -- Not an UPDATE OF is_public, so this does not re-enter the trigger.
      update public.mosaic_submissions set project_id = null, pixel_id = null where id = new.id;
    end if;
  end if;
  return null;
end;
$fn$;
drop trigger if exists mosaic_submissions_visibility_changed on public.mosaic_submissions;
create trigger mosaic_submissions_visibility_changed
  after update of is_public on public.mosaic_submissions
  for each row
  when (old.is_public is distinct from new.is_public)
  execute function public.mosaic_submissions_visibility_changed();

-- ── A4. who can read an artwork row ─────────────────────────────────────
-- Replaces "viewable by everyone" (supabase_mosaic.sql). The portfolio
-- clause is what lets a visitor of a public or link-only portfolio see the
-- private artworks in it — pieces included, through parent_id. The
-- subqueries run under the caller's own RLS on the portfolio tables, so a
-- PRIVATE portfolio never opens anything to anyone but its owner.
drop policy if exists "Mosaic submissions are viewable by everyone" on public.mosaic_submissions;
drop policy if exists "Public artworks for everyone, private ones for the artist, admins and public-portfolio viewers" on public.mosaic_submissions;
create policy "Public artworks for everyone, private ones for the artist, admins and public-portfolio viewers"
  on public.mosaic_submissions for select
  using (
    is_public
    or author_id = auth.uid()
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
    or exists (
      select 1
      from public.mosaic_collection_items ci
      join public.mosaic_collections c on c.id = ci.collection_id
      where c.is_public
        and ci.submission_id = coalesce(mosaic_submissions.parent_id, mosaic_submissions.id)
    )
  );

-- A colour-by-number board is a 48-pixel copy of the picture: readable
-- exactly when its artwork is (the subquery runs under the policy above).
drop policy if exists "Anyone can read pixel boards" on public.pixel_boards;
drop policy if exists "Pixel boards are readable when their artwork is" on public.pixel_boards;
create policy "Pixel boards are readable when their artwork is"
  on public.pixel_boards for select
  using (exists (select 1 from public.mosaic_submissions s where s.id = artwork_id));

-- ── A5. the matching pass skips private pieces ──────────────────────────
-- supabase_mosaic_pieces.sql §5 with one more condition in the pool query
-- (`sub.is_public`). Everything else is unchanged; see that file for the
-- reasoning behind each step.
create or replace function public.match_pool_artworks()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s record;
  v_pixel_id bigint;
  v_project_id bigint;
  v_dist_sq double precision;
  v_updated integer;
  v_placed jsonb := '[]'::jsonb;
  v_max double precision;
  v_home bigint;
  v_batch constant integer := 1500;
begin
  if auth.uid() is null then
    raise exception 'must be signed in to run artwork matching';
  end if;
  perform pg_advisory_xact_lock(hashtext('commit_pool_matches'));
  v_max := public.piece_match_distance();

  for s in
    select sub.id, sub.parent_id, sub.author_id, sub.lab_l, sub.lab_a, sub.lab_b, sub.home_project_id
    from public.mosaic_submissions sub
    left join public.mosaic_projects pr on pr.id = sub.home_project_id and not pr.is_archived
    where sub.parent_id is not null and sub.project_id is null and sub.pixel_id is null and sub.lab_l is not null
      and sub.is_public
      and (sub.match_tried_at is null or pr.id is null or sub.match_tried_at < pr.cells_changed_at)
    order by sub.match_tried_at asc nulls first, sub.created_at asc, sub.id asc
    limit v_batch
  loop
    v_home := s.home_project_id;
    if v_home is null or not exists (select 1 from public.mosaic_projects where id = v_home and not is_archived) then
      -- No campaign yet, or its campaign is gone: the artwork (all its pieces
      -- with it) moves to the newest active campaign.
      select id into v_home from public.mosaic_projects where not is_archived order by created_at desc limit 1;
      if v_home is null then
        exit; -- no campaign at all — nothing to place anywhere
      end if;
      update public.mosaic_submissions set home_project_id = v_home
      where id = s.parent_id or parent_id = s.parent_id;
    end if;

    v_pixel_id := null;
    select p.id, p.project_id,
           0.2 * (p.lab_l - s.lab_l) ^ 2 + (p.lab_a - s.lab_a) ^ 2 + (p.lab_b - s.lab_b) ^ 2
    into v_pixel_id, v_project_id, v_dist_sq
    from public.mosaic_pixels p
    where p.project_id = v_home and p.filled = false and p.lab_l is not null
    order by 3 asc
    limit 1;

    update public.mosaic_submissions set match_tried_at = now() where id = s.id;
    if v_pixel_id is null or sqrt(v_dist_sq) > v_max then
      continue; -- no open cell, or nothing close enough: stays pooled
    end if;

    update public.mosaic_pixels
    set filled = true, submission_id = s.id, claimed_by = s.author_id, claimed_at = now()
    where id = v_pixel_id and filled = false;
    get diagnostics v_updated = row_count;
    if v_updated = 1 then
      update public.mosaic_submissions
      set project_id = v_project_id, pixel_id = v_pixel_id
      where id = s.id;
      v_placed := v_placed || jsonb_build_object('submission_id', s.id, 'parent_id', s.parent_id, 'pixel_id', v_pixel_id);
    end if;
  end loop;

  return v_placed;
end;
$$;
revoke execute on function public.match_pool_artworks() from public;
grant execute on function public.match_pool_artworks() to authenticated;

-- ── A6. public counters and strips count public artworks only ───────────
-- The stats bar on the home page.
create or replace view public.mosaic_stats as
select
  (select count(*) from public.profiles)                                                     as artist_count,
  (select count(*) from public.mosaic_submissions where parent_id is null and is_public)      as artwork_count,
  (select count(*) from public.mosaic_projects where not is_archived)                         as project_count,
  (select coalesce(round(100.0 * count(*) filter (where px.filled) / nullif(count(*), 0)), 0)
     from public.mosaic_pixels px
     join public.mosaic_projects p on p.id = px.project_id
     where not p.is_archived)                                                                as fill_percent;
grant select on public.mosaic_stats to anon, authenticated;

-- These three are SECURITY DEFINER readers that hand out an artwork's title
-- and thumbnail by id, so RLS does not protect them: each gets the filter.
-- A private artwork's game records and colourings stay in the tables and
-- come back the moment it is public again.

-- supabase_pixel_game.sql: the "coloured artworks" strip on a profile.
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
  where p.user_id = p_user_id and p.completed_at is not null and s.is_public
  order by p.completed_at desc
  limit greatest(1, least(coalesce(p_limit, 24), 100));
$$;
revoke execute on function public.pixel_user_completions(uuid, integer) from public;
grant execute on function public.pixel_user_completions(uuid, integer) to anon, authenticated;

-- supabase_game_medal_rules.sql: the medal strip on a profile.
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
      and s.is_public
    order by k.rn, k.elapsed_ms, k.artwork_id
    limit greatest(1, least(coalesce(p_limit, 24), 60))
  ) t;
$fn$;
revoke execute on function public.game_medal_artworks(uuid, integer) from public;
grant execute on function public.game_medal_artworks(uuid, integer) to anon, authenticated;

-- supabase_game_medal_rules.sql: the "recent games" list on the game page.
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
      and exists (select 1 from public.mosaic_submissions a where a.id = s.artwork_id and a.is_public)
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

-- ══════════════════════════════════════════════════════════════════════════
-- Part B — portfolios (the former "exhibitions")
-- ══════════════════════════════════════════════════════════════════════════

-- ── B1. new columns ─────────────────────────────────────────────────────
-- cover_submission_id: the artwork the viewer's hero and the share card
--   show; null = the first artwork in the portfolio's order.
-- preview_image_url: the 1200×630 share card the browser renders and
--   uploads whenever the owner changes something (title, cover, artworks) —
--   what Facebook / X / KakaoTalk unfurl. Null = the cover picture itself.
-- layout: how the viewer page arranges the artworks.
alter table public.mosaic_collections
  add column if not exists cover_submission_id bigint references public.mosaic_submissions(id) on delete set null,
  add column if not exists preview_image_url text,
  add column if not exists layout text not null default 'grid';
alter table public.mosaic_collections drop constraint if exists mosaic_collections_layout_check;
alter table public.mosaic_collections
  add constraint mosaic_collections_layout_check check (layout in ('grid', 'masonry', 'story'));

-- The owner's order. Null sorts last (then by added_at) so rows from before
-- this column keep the order they always had.
alter table public.mosaic_collection_items
  add column if not exists position integer;
create index if not exists mosaic_collection_items_order_idx
  on public.mosaic_collection_items (collection_id, position, added_at);

-- Retired: the self-expiring "end date" of the exhibition era. The column
-- stays (dropping data is not this file's job) but nothing reads it any
-- more, so a value left in it must not keep a portfolio out of the directory.
update public.mosaic_collections set end_date = null where end_date is not null;

-- ── B2. a portfolio holds its owner's own artworks only ─────────────────
-- Replaces "Owners can add items to their own collection": the row must be
-- an artwork (not a piece) by the same person. The lightbox and the pickers
-- only offer those anyway; this is the rule the API enforces.
drop policy if exists "Owners can add items to their own collection" on public.mosaic_collection_items;
drop policy if exists "Owners add their own artworks to their own portfolio" on public.mosaic_collection_items;
create policy "Owners add their own artworks to their own portfolio"
  on public.mosaic_collection_items for insert
  with check (
    exists (select 1 from public.mosaic_collections c where c.id = collection_id and c.owner_id = auth.uid())
    and exists (select 1 from public.mosaic_submissions s
                where s.id = submission_id and s.author_id = auth.uid() and s.parent_id is null)
  );

-- Reordering = updating `position` on rows of one's own portfolio.
drop policy if exists "Owners can reorder their own portfolio" on public.mosaic_collection_items;
create policy "Owners can reorder their own portfolio"
  on public.mosaic_collection_items for update
  using (exists (select 1 from public.mosaic_collections c where c.id = collection_id and c.owner_id = auth.uid()))
  with check (exists (select 1 from public.mosaic_collections c where c.id = collection_id and c.owner_id = auth.uid()));
grant update (position) on public.mosaic_collection_items to authenticated;
