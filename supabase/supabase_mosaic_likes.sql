-- Run this once in the Supabase SQL editor (Project → SQL Editor → New query).
-- Likes on individual mosaic artwork submissions (weavo.html) — also the
-- pool a user's profile "Liked" grid and the Collections add-artwork picker
-- draw from (there is no separate "save"/"collect" concept anymore; see
-- supabase_migrate_saves_into_likes.sql for the one-time migration off the
-- old mosaic_submission_saves table).
-- Mirrors the pattern used by public.cell_likes (supabase_likes.sql) but
-- keys off mosaic_submissions.id instead of a cell_key string, since mosaic
-- artwork lives in its own table.

create table if not exists public.mosaic_submission_likes (
  submission_id bigint not null references public.mosaic_submissions(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (submission_id, user_id)
);

create index if not exists mosaic_submission_likes_submission_id_idx
  on public.mosaic_submission_likes (submission_id);

alter table public.mosaic_submission_likes enable row level security;

drop policy if exists "Mosaic likes are viewable by everyone" on public.mosaic_submission_likes;
create policy "Mosaic likes are viewable by everyone"
  on public.mosaic_submission_likes for select
  using (true);

drop policy if exists "Signed-in users can like mosaic artwork" on public.mosaic_submission_likes;
create policy "Signed-in users can like mosaic artwork"
  on public.mosaic_submission_likes for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can remove their own mosaic like" on public.mosaic_submission_likes;
create policy "Users can remove their own mosaic like"
  on public.mosaic_submission_likes for delete
  using (auth.uid() = user_id);

grant select on public.mosaic_submission_likes to anon, authenticated;
grant insert, delete on public.mosaic_submission_likes to authenticated;

-- Likes are also shown on the liking user's own profile page (profile.html/
-- js/profile-view.js), the same role mosaic_submission_saves used to play,
-- which is why the select policy above is public rather than owner-only.
