-- ============================================================
-- Фаза 2 FMS: график ТО + сервисные записи
--
-- КАК ПРИМЕНИТЬ: Supabase SQL Editor → выполнить целиком.
-- Идемпотентно. Требует scripts/fleet-lifecycle.sql (mixers).
-- ============================================================

create table if not exists public.fleet_service_schedules (
  id              bigserial primary key,
  mixer_id        bigint not null references public.mixers(id) on delete cascade,
  service_kind    text not null,
  title           text,
  interval_km     numeric,
  interval_days   int,
  interval_hours  numeric,
  last_done_at    timestamptz,
  last_odometer   numeric,
  last_engine_hours numeric,
  created_at      timestamptz not null default now()
);

create index if not exists fleet_service_schedules_mixer_id_idx
  on public.fleet_service_schedules (mixer_id);

comment on table public.fleet_service_schedules is
  'Шаблоны ТО: интервал по км / дням / моточасам';

create table if not exists public.fleet_service_records (
  id             bigserial primary key,
  mixer_id       bigint not null references public.mixers(id) on delete cascade,
  schedule_id    bigint references public.fleet_service_schedules(id) on delete set null,
  status         text not null default 'done',
  service_date   date not null default (current_date),
  odometer_km    numeric,
  description    text,
  parts          jsonb not null default '[]'::jsonb,
  labor_cost     numeric not null default 0,
  parts_cost     numeric not null default 0,
  performed_by   text,
  photos         jsonb not null default '[]'::jsonb,
  created_at     timestamptz not null default now(),
  created_by     text
);

create index if not exists fleet_service_records_mixer_id_idx
  on public.fleet_service_records (mixer_id, service_date desc);

create index if not exists fleet_service_records_status_idx
  on public.fleet_service_records (status)
  where status in ('requested', 'in_progress');

comment on table public.fleet_service_records is
  'Сервисные записи: requested | in_progress | done';
comment on column public.fleet_service_records.status is
  'requested | in_progress | done';

alter table public.fleet_service_schedules enable row level security;
alter table public.fleet_service_records enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'fleet_service_schedules'
      and policyname = 'fleet_service_schedules_deny_all'
  ) then
    create policy fleet_service_schedules_deny_all on public.fleet_service_schedules
      for all to anon, authenticated
      using (false)
      with check (false);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'fleet_service_records'
      and policyname = 'fleet_service_records_deny_all'
  ) then
    create policy fleet_service_records_deny_all on public.fleet_service_records
      for all to anon, authenticated
      using (false)
      with check (false);
  end if;
end $$;

select 'fleet-service ready' as status,
  (select count(*)::int from public.fleet_service_schedules) as schedules,
  (select count(*)::int from public.fleet_service_records) as records;

notify pgrst, 'reload schema';
