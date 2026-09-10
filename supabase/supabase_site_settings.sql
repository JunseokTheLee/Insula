-- Run this once in the Supabase SQL editor (Project → SQL Editor → New query).
-- Run AFTER supabase_mosaic.sql (needs profiles.is_admin). Independent of
-- the other 2026-09-10 files (grid image, server matching).
--
-- Site-wide options (2026-09-10). One jsonb row that every page may read
-- and only admins change — from the /admin page's "Site options" section,
-- never from code constants or a redeploy. The row holds ONLY the keys an
-- admin has changed; every other option takes its default from
-- SITE_SETTING_DEFAULTS in js/common.js, so adding an option needs no new
-- SQL. Until this file has been applied, pages simply use those defaults
-- and the admin page marks the section unavailable.
--
-- Options that must also be enforced server-side (e.g. a future "uploads
-- closed") read this same row from their RLS policy / RPC:
--   (select (settings->>'uploadsOpen')::boolean from public.site_settings)

-- ── singleton row ───────────────────────────────────────────────────────
create table if not exists public.site_settings (
  id          boolean primary key default true,
  settings    jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  updated_by  uuid,                                   -- informational: last admin to save
  constraint site_settings_singleton check (id),
  constraint site_settings_is_object check (jsonb_typeof(settings) = 'object')
);
insert into public.site_settings (id) values (true) on conflict (id) do nothing;

alter table public.site_settings enable row level security;
drop policy if exists "site_settings is readable by everyone" on public.site_settings;
create policy "site_settings is readable by everyone"
  on public.site_settings for select using (true);
grant select on public.site_settings to anon, authenticated;
-- No insert/update/delete grant: the row only changes through the RPC
-- below (security definer, so it bypasses that).

-- ── admin_set_site_settings: merge a patch into the row (admins only) ───
-- p_patch is a JSON object of the keys to change, e.g.
--   {"showCampaignPreview": true}
-- Keys not in the patch are left as they are; a key whose value is null is
-- REMOVED (back to its code default). Returns the whole stored object.
create or replace function public.admin_set_site_settings(p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settings jsonb;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then
    raise exception 'only admins can change site settings';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'p_patch must be a JSON object';
  end if;

  select jsonb_strip_nulls(settings || p_patch) into v_settings
  from public.site_settings where id = true for update;
  if v_settings is null then
    raise exception 'site_settings row is missing';
  end if;
  -- Options are a handful of flags; anything approaching this is a mistake.
  if pg_column_size(v_settings) > 16384 then
    raise exception 'site settings too large';
  end if;

  update public.site_settings
  set settings = v_settings, updated_at = now(), updated_by = auth.uid()
  where id = true;
  return v_settings;
end;
$$;

revoke execute on function public.admin_set_site_settings(jsonb) from public;
grant execute on function public.admin_set_site_settings(jsonb) to authenticated; -- gated to admins inside
