-- ============================================================
-- Фаза 1 FMS: lifecycle, документы, напоминания, телематика СКАУТ
--
-- КАК ПРИМЕНИТЬ: Supabase SQL Editor → выполнить целиком.
-- Идемпотентно.
-- ============================================================

-- --- mixers: lifecycle + scout ---
alter table public.mixers
  add column if not exists lifecycle_status text default 'active',
  add column if not exists odometer_km numeric,
  add column if not exists engine_hours numeric,
  add column if not exists scout_unit_id int;

comment on column public.mixers.lifecycle_status is
  'active | repair | conservation | sold | rented_out';
comment on column public.mixers.scout_unit_id is
  'UnitId объекта в СКАУТ СПИК';

create index if not exists mixers_scout_unit_id_idx
  on public.mixers (scout_unit_id)
  where scout_unit_id is not null;

-- Один UnitId СКАУТ → одно ТС (дубли ломают sync)
create unique index if not exists mixers_scout_unit_id_uidx
  on public.mixers (scout_unit_id)
  where scout_unit_id is not null;

-- --- fleet_documents ---
create table if not exists public.fleet_documents (
  id           bigserial primary key,
  mixer_id     bigint not null references public.mixers(id) on delete cascade,
  doc_type     text not null,
  title        text,
  file_name    text not null,
  storage_path text not null unique,
  mime_type    text,
  size_bytes   bigint,
  expires_at   timestamptz,
  created_at   timestamptz not null default now(),
  created_by   text
);

create index if not exists fleet_documents_mixer_id_idx
  on public.fleet_documents (mixer_id, created_at desc);

comment on table public.fleet_documents is
  'Документы ТС: СТС, ОСАГО, техосмотр и т.д.';

-- --- fleet_reminders ---
create table if not exists public.fleet_reminders (
  id            bigserial primary key,
  mixer_id      bigint not null references public.mixers(id) on delete cascade,
  kind          text not null,
  title         text not null,
  due_date      date,
  due_odometer  numeric,
  status        text not null default 'pending',
  created_at    timestamptz not null default now()
);

create index if not exists fleet_reminders_mixer_id_idx
  on public.fleet_reminders (mixer_id, status);

comment on table public.fleet_reminders is
  'Напоминания: document_expiry | service_due | custom';

-- --- fleet_telemetry_snapshots (СКАУТ) ---
create table if not exists public.fleet_telemetry_snapshots (
  id               bigserial primary key,
  mixer_id         bigint not null references public.mixers(id) on delete cascade,
  scout_unit_id    int,
  lat              numeric,
  lon              numeric,
  speed_kmh        numeric,
  address          text,
  last_message_at  timestamptz,
  is_online        boolean not null default false,
  raw              jsonb,
  updated_at       timestamptz not null default now(),
  unique (mixer_id)
);

create index if not exists fleet_telemetry_online_idx
  on public.fleet_telemetry_snapshots (is_online, updated_at desc);

comment on table public.fleet_telemetry_snapshots is
  'Последняя телематика СКАУТ по каждой единице техники';

-- --- RLS: доступ только через service role (Next API) ---
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

-- --- Storage bucket fleet-documents ---
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'fleet-documents',
  'fleet-documents',
  false,
  20971520,
  array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp'
  ]
)
on conflict (id) do update set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

select 'fleet-lifecycle ready' as status,
  (select count(*)::int from public.fleet_documents) as documents,
  (select count(*)::int from public.fleet_telemetry_snapshots) as telemetry_rows;

-- PostgREST: подхватить новые таблицы без ожидания
notify pgrst, 'reload schema';

-- Broadcast для карты парка (после sync СКАУТ):
-- выполните отдельно scripts/broadcast-fleet-telemetry-setup.sql
--
-- Если fleet-lifecycle.sql уже применяли раньше — догоните hardening:
-- scripts/fleet-lifecycle-hardening.sql
