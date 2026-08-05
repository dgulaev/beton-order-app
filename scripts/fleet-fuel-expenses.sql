-- ============================================================
-- Фаза 3 FMS: заправки, доп. расходы, тариф рейса в order_mixers
--
-- КАК ПРИМЕНИТЬ: Supabase SQL Editor → выполнить целиком.
-- Идемпотентно. Требует mixers (fleet-lifecycle).
-- ============================================================

create table if not exists public.fuel_entries (
  id           bigserial primary key,
  mixer_id     bigint not null references public.mixers(id) on delete cascade,
  filled_at    timestamptz not null default now(),
  liters       numeric not null,
  amount_rub   numeric,
  odometer_km  numeric,
  fuel_type    text,
  receipt_path text,
  created_by   text,
  created_at   timestamptz not null default now(),
  constraint fuel_entries_liters_positive check (liters > 0)
);

create index if not exists fuel_entries_mixer_filled_idx
  on public.fuel_entries (mixer_id, filled_at desc);

comment on table public.fuel_entries is
  'Заправки ТС: литры, ₽, одометр, чек (storage path)';

create table if not exists public.fleet_expenses (
  id           bigserial primary key,
  mixer_id     bigint not null references public.mixers(id) on delete cascade,
  expense_date date not null default (current_date),
  category     text not null,
  amount_rub   numeric not null,
  description  text,
  receipt_path text,
  created_by   text,
  created_at   timestamptz not null default now(),
  constraint fleet_expenses_amount_positive check (amount_rub >= 0)
);

create index if not exists fleet_expenses_mixer_date_idx
  on public.fleet_expenses (mixer_id, expense_date desc);

comment on table public.fleet_expenses is
  'Доп. расходы ТС: wash | tire | parking | toll | other';

-- Итог тарифа non-mixer при закрытии рейса (этап 2 fleetTariffs)
alter table public.order_mixers
  add column if not exists fleet_tariff_cash numeric,
  add column if not exists fleet_tariff_noncash numeric,
  add column if not exists fleet_tariff_label text,
  add column if not exists fleet_tariff_detail text;

comment on column public.order_mixers.fleet_tariff_cash is
  'Фаза 3: тариф рейса/смены (нал), ₽ — из mixers.specs при Разгружен';
comment on column public.order_mixers.fleet_tariff_noncash is
  'Фаза 3: тариф рейса/смены (безнал), ₽';

alter table public.fuel_entries enable row level security;
alter table public.fleet_expenses enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'fuel_entries'
      and policyname = 'fuel_entries_deny_all'
  ) then
    create policy fuel_entries_deny_all on public.fuel_entries
      for all to anon, authenticated
      using (false)
      with check (false);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'fleet_expenses'
      and policyname = 'fleet_expenses_deny_all'
  ) then
    create policy fleet_expenses_deny_all on public.fleet_expenses
      for all to anon, authenticated
      using (false)
      with check (false);
  end if;
end $$;

select 'fleet-fuel-expenses ready' as status,
  (select count(*)::int from public.fuel_entries) as fuel_rows,
  (select count(*)::int from public.fleet_expenses) as expense_rows;

notify pgrst, 'reload schema';
