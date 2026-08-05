-- ============================================================
-- Догон для уже применённого fleet-lifecycle.sql (Фаза 1).
-- RLS + UNIQUE scout_unit_id + убрать octet-stream из bucket.
--
-- КАК ПРИМЕНИТЬ: Supabase SQL Editor → выполнить целиком.
-- Идемпотентно. Если unique index падает — есть дубли scout_unit_id,
-- сначала почистите: select scout_unit_id, count(*) from mixers
--   where scout_unit_id is not null group by 1 having count(*) > 1;
-- ============================================================

create unique index if not exists mixers_scout_unit_id_uidx
  on public.mixers (scout_unit_id)
  where scout_unit_id is not null;

alter table public.fleet_documents enable row level security;
alter table public.fleet_reminders enable row level security;
alter table public.fleet_telemetry_snapshots enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'fleet_documents' and policyname = 'fleet_documents_deny_all'
  ) then
    create policy fleet_documents_deny_all on public.fleet_documents
      for all to anon, authenticated
      using (false)
      with check (false);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'fleet_reminders' and policyname = 'fleet_reminders_deny_all'
  ) then
    create policy fleet_reminders_deny_all on public.fleet_reminders
      for all to anon, authenticated
      using (false)
      with check (false);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'fleet_telemetry_snapshots'
      and policyname = 'fleet_telemetry_snapshots_deny_all'
  ) then
    create policy fleet_telemetry_snapshots_deny_all on public.fleet_telemetry_snapshots
      for all to anon, authenticated
      using (false)
      with check (false);
  end if;
end $$;

update storage.buckets
set allowed_mime_types = array[
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp'
]
where id = 'fleet-documents';

select 'fleet-lifecycle-hardening ready' as status;

notify pgrst, 'reload schema';
