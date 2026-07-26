-- Run this once in the Supabase SQL editor (Project → SQL Editor → New query).
-- Likes and saves on individual mosaic artwork submissions (weavo.html).
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

-- ── saves (bookmarks) ────────────────────────────────────────────────────
create table if not exists public.mosaic_submission_saves (
  submission_id bigint not null references public.mosaic_submissions(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (submission_id, user_id)
);

create index if not exists mosaic_submission_saves_user_id_idx
  on public.mosaic_submission_saves (user_id);

alter table public.mosaic_submission_saves enable row level security;

-- Saves are public — they're shown on the saving user's profile page
-- (main.html / profile.js), so anyone needs to be able to read them.
drop policy if exists "Users can view their own mosaic saves" on public.mosaic_submission_saves;
drop policy if exists "Mosaic saves are viewable by everyone" on public.mosaic_submission_saves;
create policy "Mosaic saves are viewable by everyone"
  on public.mosaic_submission_saves for select
  using (true);

drop policy if exists "Signed-in users can save mosaic artwork" on public.mosaic_submission_saves;
create policy "Signed-in users can save mosaic artwork"
  on public.mosaic_submission_saves for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can remove their own mosaic save" on public.mosaic_submission_saves;
create policy "Users can remove their own mosaic save"
  on public.mosaic_submission_saves for delete
  using (auth.uid() = user_id);

grant select on public.mosaic_submission_saves to anon, authenticated;
grant insert, delete on public.mosaic_submission_saves to authenticated;
