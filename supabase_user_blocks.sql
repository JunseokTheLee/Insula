-- Run this once in the Supabase SQL editor (Project → SQL Editor → New query).
-- Lets a signed-in user block another user — the "block abusive users"
-- control Apple App Store guideline 1.2 (UGC) requires. Separate from
-- public.reports (supabase_reports.sql): a report flags something for a
-- moderator to review later; a block is a private, immediate, no-moderator
-- filter that only ever affects the blocker's own view (and, per the policy
-- below, stops the blocked user from commenting on the blocker's artwork).

create table if not exists public.user_blocks (
  blocker_id  uuid not null references auth.users(id) on delete cascade,
  blocked_id  uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (blocker_id, blocked_id)
);

alter table public.user_blocks enable row level security;

-- A blocker only ever sees their own block list — never who blocked *them*,
-- and never another user's list.
drop policy if exists "Users can view their own blocks" on public.user_blocks;
create policy "Users can view their own blocks"
  on public.user_blocks for select
  using (auth.uid() = blocker_id);

drop policy if exists "Users can block others" on public.user_blocks;
create policy "Users can block others"
  on public.user_blocks for insert
  with check (auth.uid() = blocker_id);

drop policy if exists "Users can unblock others" on public.user_blocks;
create policy "Users can unblock others"
  on public.user_blocks for delete
  using (auth.uid() = blocker_id);

-- RLS policies only take effect once the role has table-level privileges too
-- — see supabase_profiles.sql for the same gotcha with anon/select.
grant select, insert, delete on public.user_blocks to authenticated;

-- ---------- server-side enforcement ----------
-- The client-side filtering (comment lists, recent artworks, the artist
-- directory, network graphs) keeps a blocked user out of the *blocker's*
-- view, but nothing stops that filtering from being bypassed. This is the
-- one place a block also has to be enforced server-side: a blocked user
-- must not be able to keep commenting straight onto the blocker's own
-- artwork. Extends the insert policy from supabase_mosaic_comments.sql with
-- an extra check — the artwork's author must not have blocked the
-- commenter — rather than a trigger, since (unlike that file's parent-id
-- check) this is a plain join across two other tables, not a correlated
-- self-reference, which is exactly what RLS "with check" subqueries are
-- fine with (e.g. the reports table's own admin-only select policy).
drop policy if exists "Signed-in users can post mosaic comments" on public.mosaic_submission_comments;
create policy "Signed-in users can post mosaic comments"
  on public.mosaic_submission_comments for insert
  with check (
    auth.uid() = author_id
    and not exists (
      select 1 from public.mosaic_submissions s
      join public.user_blocks b on b.blocker_id = s.author_id and b.blocked_id = author_id
      where s.id = submission_id
    )
  );
