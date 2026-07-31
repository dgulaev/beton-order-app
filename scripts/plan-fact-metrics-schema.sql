-- ============================================================
-- Интеллект планирования V2.0: утренний снимок + метрики план/факт + калибровка.
--
-- КАК ПРИМЕНИТЬ:
--   Supabase Dashboard → SQL Editor → выполнить скрипт целиком.
-- Идемпотентен.
-- ============================================================

-- 1) Утренний снимок на daily_logistics_plans
alter table public.daily_logistics_plans
  add column if not exists morning_payload jsonb;
alter table public.daily_logistics_plans
  add column if not exists morning_captured_at timestamptz;

comment on column public.daily_logistics_plans.morning_payload is
  'V2: снимок плана после первого full_day (не перезаписывается этапами)';
comment on column public.daily_logistics_plans.morning_captured_at is
  'V2: когда зафиксировали morning_payload';

-- 2) Метрики рейса план ↔ факт
create table if not exists public.plan_fact_trip_metrics (
  id                    bigserial primary key,
  delivery_date         date not null,
  plan_trip_id          text not null,
  order_id              bigint,
  order_mixer_id        bigint,
  mixer_number          text,
  volume_m3             numeric(10, 2),
  -- план
  plan_load_at          text,
  plan_arrive_at        text,
  plan_load_min         numeric(8, 2),
  plan_road_min         numeric(8, 2),
  plan_unload_min       numeric(8, 2),
  -- факт
  fact_load_start       timestamptz,
  fact_release_at       timestamptz,
  fact_on_site_at       timestamptz,
  fact_unloaded_at      timestamptz,
  -- дельты / длительности (мин)
  delta_load_start_min  numeric(8, 2),
  fact_load_dur_min     numeric(8, 2),
  fact_road_min         numeric(8, 2),
  fact_onsite_min       numeric(8, 2),
  delta_cycle_min       numeric(8, 2),
  -- качество
  match_kind            text not null default 'none',
  no_operator           boolean not null default false,
  snapshot_quality      text not null default 'morning',
  computed_at           timestamptz not null default now(),
  unique (delivery_date, plan_trip_id)
);

create index if not exists plan_fact_trip_metrics_date_idx
  on public.plan_fact_trip_metrics (delivery_date);
create index if not exists plan_fact_trip_metrics_order_idx
  on public.plan_fact_trip_metrics (order_id);

comment on table public.plan_fact_trip_metrics is
  'V2: сравнение планового рейса интеллекта с фактом order_mixers/production_logs';

alter table public.plan_fact_trip_metrics enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'plan_fact_trip_metrics'
      and policyname = 'plan_fact_trip_metrics_deny_all'
  ) then
    create policy plan_fact_trip_metrics_deny_all on public.plan_fact_trip_metrics
      for all to anon, authenticated
      using (false)
      with check (false);
  end if;
end $$;

-- 3) Текущая калибровка норм (один ряд id=1)
create table if not exists public.planner_calibration_current (
  id            smallint primary key default 1 check (id = 1),
  payload       jsonb not null default '{}'::jsonb,
  samples       integer not null default 0,
  days_used     integer not null default 0,
  updated_at    timestamptz not null default now()
);

insert into public.planner_calibration_current (id, payload)
values (1, '{}'::jsonb)
on conflict (id) do nothing;

comment on table public.planner_calibration_current is
  'V2: актуальные нормы load/road/unload/join из истории план↔факт';

alter table public.planner_calibration_current enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'planner_calibration_current'
      and policyname = 'planner_calibration_current_deny_all'
  ) then
    create policy planner_calibration_current_deny_all on public.planner_calibration_current
      for all to anon, authenticated
      using (false)
      with check (false);
  end if;
end $$;
