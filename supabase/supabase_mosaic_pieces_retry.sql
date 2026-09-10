-- Run this once in the Supabase SQL editor (Project → SQL Editor → New query).
-- Run AFTER supabase_mosaic_pieces.sql. Safe to re-run.
--
-- "Apply colour match to all" (admin page → Site options, 2026-09-10).
-- A matching pass only re-tries a WAITING piece when its campaign gained
-- open cells since the piece's last try (match_tried_at vs
-- mosaic_projects.cells_changed_at — supabase_mosaic_pieces.sql), so a
-- changed pieceMatchDistance option would otherwise reach the waiting pieces
-- only as cells happen to open. This RPC clears every waiting piece's
-- last-try mark, so the next pass takes all of them again, and returns how
-- many are waiting. The admin button (js/admin.js applyPieceMatchToAll)
-- pairs it with release_poor_matches('0 seconds') — the poor-match cleanup
-- without its 6-hour wait, so placed pieces beyond the new threshold are
-- released first — and then runs matching passes until the pool is done.
create or replace function public.admin_reset_piece_tries()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_waiting integer;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then
    raise exception 'admins only';
  end if;
  update public.mosaic_submissions
  set match_tried_at = null
  where parent_id is not null and pixel_id is null and match_tried_at is not null;
  select count(*) into v_waiting
  from public.mosaic_submissions
  where parent_id is not null and pixel_id is null;
  return v_waiting;
end;
$$;

revoke execute on function public.admin_reset_piece_tries() from public;
grant execute on function public.admin_reset_piece_tries() to authenticated; -- gated to admins inside

notify pgrst, 'reload schema';
