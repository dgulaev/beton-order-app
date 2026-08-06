-- ============================================================
-- Суточные показания СКАУТ (одометр, моточасы бочки, ДУТ…)
--
-- КАК ПРИМЕНИТЬ: Supabase SQL Editor → выполнить целиком.
-- Идемпотентно.
-- ============================================================

create table if not exists public.fleet_scout_daily_readings (
  id                       bigserial primary key,
  mixer_id                 bigint not null references public.mixers(id) on delete cascade,
  reading_date             date not null,
  scout_unit_id            int,
  odometer_km              numeric,
  chassis_engine_on_hours  numeric,
  chassis_engine_idle_hours numeric,
  drum_engine_hours        numeric,
  drum_sensor_index        int,
  fuel_level_l             numeric,
  period_mileage_km        numeric,
  raw                      jsonb,
  created_at               timestamptz not null default now(),
  unique (mixer_id, reading_date)
);

create index if not exists fleet_scout_daily_readings_date_idx
  on public.fleet_scout_daily_readings (reading_date desc);

create index if not exists fleet_scout_daily_readings_mixer_idx
  on public.fleet_scout_daily_readings (mixer_id, reading_date desc);

comment on table public.fleet_scout_daily_readings is
  'Суточный снимок датчиков СКАУТ по ТС (cron + ручная синхронизация)';

alter table public.fleet_scout_daily_readings enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'fleet_scout_daily_readings'
      and policyname = 'fleet_scout_daily_readings_deny_all'
  ) then
    create policy fleet_scout_daily_readings_deny_all
      on public.fleet_scout_daily_readings
      for all to anon, authenticated
      using (false)
      with check (false);
  end if;
end $$;
