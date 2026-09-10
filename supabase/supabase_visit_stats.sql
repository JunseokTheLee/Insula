-- Run this once in the Supabase SQL editor (Project → SQL Editor → New query).
-- Run AFTER supabase_profiles.sql and supabase_mosaic.sql (profiles.is_admin,
-- mosaic_submissions) and AFTER supabase_site_settings.sql (the countVisits
-- option is read from that table).
--
-- Visitor statistics for the admin page (2026-09-10). One row per day
-- (Asia/Seoul) holding two counters — guests and members — and nothing
-- else: no visitor ids, no IPs, no user ids. There is nothing personal in
-- here and nothing to prune (about 40 KB a year). js/auth.js calls
-- record_visit() once per browser per day per kind; THIS function decides
-- the kind from auth.uid(), so a browser cannot pose as a member. The
-- admin page calls admin_visit_stats(10): one row per day for the last N
-- days (days without a row come back as 0) plus new artworks and new
-- members per day, counted from the existing created_at columns.
--
-- "Today" is the Asia/Seoul date everywhere (the database runs in UTC);
-- the client uses the same zone for its once-a-day mark, so the two agree.
-- Until this file has been applied, record_visit() fails once per browser
-- per day (PGRST202, ignored) and the admin section shows a notice.

-- ── 1. visit_days ────────────────────────────────────────────────────────
create table if not exists public.visit_days (
  day     date primary key,
  guests  integer not null default 0,
  members integer not null default 0
);
alter table public.visit_days enable row level security;
-- No policies and no table grants: the rows are only touched through the
-- two security-definer functions below.
revoke all on table public.visit_days from anon, authenticated;

-- ── 2. record_visit: +1 guest or +1 member for today ────────────────────
-- Callable by everyone, anon included. Honours the admin's "countVisits"
-- site option here, on the server, so switching it off in /admin really
-- stops recording rather than just asking browsers not to call.
create or replace function public.record_visit()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today  date    := (now() at time zone 'Asia/Seoul')::date;
  v_member boolean := auth.uid() is not null;
begin
  if coalesce((select (settings->>'countVisits')::boolean
               from public.site_settings where id = true), true) is false then
    return;
  end if;
  insert into public.visit_days as v (day, guests, members)
  values (v_today,
          case when v_member then 0 else 1 end,
          case when v_member then 1 else 0 end)
  on conflict (day) do update
    set guests  = v.guests  + excluded.guests,
        members = v.members + excluded.members;
end;
$$;

revoke execute on function public.record_visit() from public;
grant execute on function public.record_visit() to anon, authenticated;

-- ── 3. admin_visit_stats: the last N days for the admin page ─────────────
-- Admins only. p_days is clamped to 1..90. Every day in the range is
-- returned, oldest first, with zeros where nothing was recorded.
create or replace function public.admin_visit_stats(p_days integer default 10)
returns table (day date, guests integer, members integer, new_artworks integer, new_members integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_days    integer := least(greatest(coalesce(p_days, 10), 1), 90);
  v_today   date    := (now() at time zone 'Asia/Seoul')::date;
  v_from    date;
  v_from_ts timestamptz;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then
    raise exception 'admins only';
  end if;
  v_from    := v_today - (v_days - 1);
  v_from_ts := (v_from::timestamp) at time zone 'Asia/Seoul';   -- Seoul midnight of the first day
  return query
  with days as (
    select (v_from + i)::date as d from generate_series(0, v_days - 1) as i
  ), arts as (
    select (s.created_at at time zone 'Asia/Seoul')::date as d, count(*)::integer as n
    from public.mosaic_submissions s
    where s.created_at >= v_from_ts
    group by 1
  ), people as (
    select (p.created_at at time zone 'Asia/Seoul')::date as d, count(*)::integer as n
    from public.profiles p
    where p.created_at >= v_from_ts
    group by 1
  )
  select days.d,
         coalesce(v.guests, 0),
         coalesce(v.members, 0),
         coalesce(arts.n, 0),
         coalesce(people.n, 0)
  from days
  left join public.visit_days v on v.day = days.d
  left join arts   on arts.d   = days.d
  left join people on people.d = days.d
  order by days.d;
end;
$$;

revoke execute on function public.admin_visit_stats(integer) from public;
grant execute on function public.admin_visit_stats(integer) to authenticated; -- gated to admins inside
