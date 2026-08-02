-- Run this once in the Supabase SQL editor (Project → SQL Editor → New query).
--
-- Direct user-to-user "saves" (an Instagram-style follow, renamed to match
-- the app's "Save"/"Saving" terminology) — separate from
-- mosaic_submission_saves (supabase_mosaic_likes.sql), which is the
-- artwork-bookmark feature now surfaced in the UI as "Collections". A row
-- here means saver_id saves saved_id; asymmetric, like a follow, not a
-- mutual friendship — two rows (A saves B, B saves A) is how a mutual
-- relationship is represented, same convention mosaic_submission_saves
-- already uses for the save-relationship graphs (js/network.js,
-- js/profile-view.js).

create table if not exists public.user_saves (
  saver_id   uuid not null references auth.users(id) on delete cascade,
  saved_id   uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (saver_id, saved_id),
  constraint user_saves_no_self_save check (saver_id <> saved_id)
);

-- primary key already indexes saver_id first — this covers the reverse
-- lookup ("who saves this profile", i.e. followers/"Saved by").
create index if not exists user_saves_saved_id_idx on public.user_saves (saved_id);

alter table public.user_saves enable row level security;

-- Saves are public — shown as follower/following counts and lists on every
-- profile page, and the whole table backs the sitewide Network graph.
drop policy if exists "User saves are viewable by everyone" on public.user_saves;
create policy "User saves are viewable by everyone"
  on public.user_saves for select
  using (true);

drop policy if exists "Signed-in users can save another user" on public.user_saves;
create policy "Signed-in users can save another user"
  on public.user_saves for insert
  with check (auth.uid() = saver_id);

drop policy if exists "Users can remove their own save" on public.user_saves;
create policy "Users can remove their own save"
  on public.user_saves for delete
  using (auth.uid() = saver_id);

grant select on public.user_saves to anon, authenticated;
grant insert, delete on public.user_saves to authenticated;
