-- ============================================================
-- Общий live-план дня интеллекта логистики (Фаза 6).
-- Один снимок на delivery_date; UI читает/пишет через API (service role).
--
-- КАК ПРИМЕНИТЬ:
--   Supabase Dashboard → SQL Editor → выполнить скрипт целиком.
-- Идемпотентен.
-- ============================================================

create table if not exists public.daily_logistics_plans (
  delivery_date       date primary key,
  payload             jsonb not null default '{}'::jsonb,
  max_text            text,
  revision            integer not null default 1,
  updated_at          timestamptz not null default now(),
  updated_by_name     text,
  updated_by_role     text,
  updated_by_user_id  bigint,
  -- Фаза 6 коллаборация: мягкая блокировка «сейчас правит…»
  editing_by_name     text,
  editing_by_user_id  bigint,
  editing_at          timestamptz
);

comment on table public.daily_logistics_plans is
  'Общий план дня интеллекта: trips/миксеры/сдвиги (payload) + текст Макс';

-- Идемпотентное добавление колонок на уже созданной таблице
alter table public.daily_logistics_plans
  add column if not exists editing_by_name text;
alter table public.daily_logistics_plans
  add column if not exists editing_by_user_id bigint;
alter table public.daily_logistics_plans
  add column if not exists editing_at timestamptz;

-- V2: утренний снимок (не затирается этапами) — полный скрипт: plan-fact-metrics-schema.sql
alter table public.daily_logistics_plans
  add column if not exists morning_payload jsonb;
alter table public.daily_logistics_plans
  add column if not exists morning_captured_at timestamptz;

alter table public.daily_logistics_plans enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'daily_logistics_plans'
      and policyname = 'daily_logistics_plans_deny_all'
  ) then
    create policy daily_logistics_plans_deny_all on public.daily_logistics_plans
      for all to anon, authenticated
      using (false)
      with check (false);
  end if;
end $$;

-- Broadcast: тонкий soft-lock — scripts/broadcast-optimize-planner.sql
-- (fallback на общий broadcast_table_change, если оптимизацию ещё не накатили)
drop trigger if exists daily_logistics_plans_broadcast on public.daily_logistics_plans;
do $$
begin
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'broadcast_daily_logistics_plans_change'
  ) then
    create trigger daily_logistics_plans_broadcast
      after insert or update or delete on public.daily_logistics_plans
      for each row execute function public.broadcast_daily_logistics_plans_change();
  else
    create trigger daily_logistics_plans_broadcast
      after insert or update or delete on public.daily_logistics_plans
      for each row execute function public.broadcast_table_change();
  end if;
end $$;

-- Топик: daily_logistics_plans:all

-- Связанный RPC (атомарное «Применить в заявки»):
--   scripts/apply-logistics-plan-order.sql
--   function public.apply_logistics_plan_trips(...)
-- Оптимизация broadcast: scripts/broadcast-optimize-planner.sql
