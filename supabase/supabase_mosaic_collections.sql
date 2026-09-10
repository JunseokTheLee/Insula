-- Run this once in the Supabase SQL editor (Project → SQL Editor → New query).
--
-- "Collections" — named boards a user curates from artwork they've already
-- liked (mosaic_submission_likes, supabase_mosaic_likes.sql). Separate from
-- that flat liked pool: liking a piece just puts it in your pool, a
-- collection is a titled, shareable grouping you build from that pool (a
-- mini exhibition) — same relationship as a Pinterest save vs. a board.
-- Membership here is independent of mosaic_submission_likes once added: a
-- piece stays on a board even if you later un-like it, matching how boards
-- behave everywhere else.

create table if not exists public.mosaic_collections (
  id          bigint generated always as identity primary key,
  owner_id    uuid not null references auth.users(id) on delete cascade,
  title       text not null check (char_length(title) between 1 and 80),
  description text check (description is null or char_length(description) <= 500),
  is_public   boolean not null default true,
  created_at  timestamptz not null default now()
);

create index if not exists mosaic_collections_owner_id_idx on public.mosaic_collections (owner_id);

alter table public.mosaic_collections enable row level security;

drop policy if exists "Public collections are viewable by everyone, private ones by their owner" on public.mosaic_collections;
create policy "Public collections are viewable by everyone, private ones by their owner"
  on public.mosaic_collections for select
  using (is_public or owner_id = auth.uid());

drop policy if exists "Signed-in users can create their own collection" on public.mosaic_collections;
create policy "Signed-in users can create their own collection"
  on public.mosaic_collections for insert
  with check (auth.uid() = owner_id);

drop policy if exists "Owners can update their own collection" on public.mosaic_collections;
create policy "Owners can update their own collection"
  on public.mosaic_collections for update
  using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

drop policy if exists "Owners can delete their own collection" on public.mosaic_collections;
create policy "Owners can delete their own collection"
  on public.mosaic_collections for delete
  using (auth.uid() = owner_id);

grant select on public.mosaic_collections to anon, authenticated;
grant insert, update, delete on public.mosaic_collections to authenticated;

-- ── collection items ────────────────────────────────────────────────────
create table if not exists public.mosaic_collection_items (
  collection_id bigint not null references public.mosaic_collections(id) on delete cascade,
  submission_id bigint not null references public.mosaic_submissions(id) on delete cascade,
  added_at      timestamptz not null default now(),
  primary key (collection_id, submission_id)
);

create index if not exists mosaic_collection_items_submission_id_idx
  on public.mosaic_collection_items (submission_id);

alter table public.mosaic_collection_items enable row level security;

-- Visibility follows the parent collection's own visibility, not a
-- separate flag — a private board's items shouldn't be readable just
-- because someone knows a submission_id.
drop policy if exists "Collection items are viewable if their collection is" on public.mosaic_collection_items;
create policy "Collection items are viewable if their collection is"
  on public.mosaic_collection_items for select
  using (exists (
    select 1 from public.mosaic_collections c
    where c.id = collection_id and (c.is_public or c.owner_id = auth.uid())
  ));

drop policy if exists "Owners can add items to their own collection" on public.mosaic_collection_items;
create policy "Owners can add items to their own collection"
  on public.mosaic_collection_items for insert
  with check (exists (
    select 1 from public.mosaic_collections c
    where c.id = collection_id and c.owner_id = auth.uid()
  ));

drop policy if exists "Owners can remove items from their own collection" on public.mosaic_collection_items;
create policy "Owners can remove items from their own collection"
  on public.mosaic_collection_items for delete
  using (exists (
    select 1 from public.mosaic_collections c
    where c.id = collection_id and c.owner_id = auth.uid()
  ));

grant select on public.mosaic_collection_items to anon, authenticated;
grant insert, delete on public.mosaic_collection_items to authenticated;
