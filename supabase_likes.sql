-- Run this once in the Supabase SQL editor (Project → SQL Editor → New query).
-- Adds likes on individual artwork/comment cells (the pieces shown in the
-- block detail modal). `cell_key` matches the `key` column already used on
-- `public.cells` (format: "{x},{y}@{parentKey}").

create table if not exists public.cell_likes (
  cell_key   text not null,
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (cell_key, user_id)
);

create index if not exists cell_likes_cell_key_idx on public.cell_likes (cell_key);

alter table public.cell_likes enable row level security;

drop policy if exists "Likes are viewable by everyone" on public.cell_likes;
create policy "Likes are viewable by everyone"
  on public.cell_likes for select
  using (true);

drop policy if exists "Signed-in users can like a piece" on public.cell_likes;
create policy "Signed-in users can like a piece"
  on public.cell_likes for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can remove their own like" on public.cell_likes;
create policy "Users can remove their own like"
  on public.cell_likes for delete
  using (auth.uid() = user_id);

grant select on public.cell_likes to anon, authenticated;
grant insert, delete on public.cell_likes to authenticated;
