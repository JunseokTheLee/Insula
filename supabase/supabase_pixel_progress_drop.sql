-- Run this once in the Supabase SQL editor (Project → SQL Editor → New query).
-- Run AFTER supabase_pixel_levels.sql (pixel_progress has its level column
-- by then). Idempotent.
--
-- Colour-by-number: a player can drop an attempt under way — the ✕ on a
-- "continue" card (2026-09-21). pixel_progress has no delete grant (rows are
-- written only through save_pixel_progress), so the drop goes through this
-- function too. It removes ONLY the caller's own UNFINISHED row for that
-- artwork and level: finished rows stay (they feed the completion counts,
-- the artist's notification and the profile strip), so a finished level can
-- never be "dropped" back to unplayed. Returns the number of rows removed
-- (0 or 1).

create or replace function public.drop_pixel_progress(p_artwork_id bigint, p_level integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  if auth.uid() is null then
    raise exception 'sign-in required';
  end if;
  if p_level is null or p_level < 1 or p_level > 3 then
    raise exception 'level must be 1, 2 or 3';
  end if;
  delete from public.pixel_progress
   where user_id = auth.uid()
     and artwork_id = p_artwork_id
     and level = p_level
     and completed_at is null;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke execute on function public.drop_pixel_progress(bigint, integer) from public, anon;
grant execute on function public.drop_pixel_progress(bigint, integer) to authenticated;
