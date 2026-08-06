-- ============================================================
-- Импорт заправок с АЗС Benza → fuel_entries + ожидание ТС
-- Требует fuel_entries (fleet-fuel-expenses.sql, fleet-fuel-scout.sql).
-- ============================================================

alter table public.fuel_entries
  add column if not exists source text not null default 'manual';

alter table public.fuel_entries
  add column if not exists benza_event_key text;

comment on column public.fuel_entries.source is
  'manual | scout | driver | benza';
comment on column public.fuel_entries.benza_event_key is
  'Идемпотентный ключ отпуска Benza (plate_norm + filled_at + liters)';

create unique index if not exists fuel_entries_benza_event_key_uidx
  on public.fuel_entries (benza_event_key)
  where benza_event_key is not null;

-- Заправки из отчёта, для которых ТС ещё нет в парке
create table if not exists public.benza_fuel_pending (
  id              bigserial primary key,
  plate_raw       text not null,
  plate_norm      text not null,
  filled_at       timestamptz not null,
  liters          numeric not null,
  benza_event_key text not null,
  import_batch    text,
  linked_entry_id bigint references public.fuel_entries(id) on delete set null,
  created_at      timestamptz not null default now(),
  constraint benza_fuel_pending_liters_positive check (liters > 0)
);

create unique index if not exists benza_fuel_pending_event_key_uidx
  on public.benza_fuel_pending (benza_event_key);

create index if not exists benza_fuel_pending_unlinked_idx
  on public.benza_fuel_pending (plate_norm, filled_at)
  where linked_entry_id is null;

comment on table public.benza_fuel_pending is
  'Отпуск Benza без ТС в справочнике; после добавления номера — в fuel_entries';

alter table public.benza_fuel_pending enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'benza_fuel_pending'
      and policyname = 'benza_fuel_pending_deny_all'
  ) then
    create policy benza_fuel_pending_deny_all on public.benza_fuel_pending
      for all using (false) with check (false);
  end if;
end $$;

select 'fleet-fuel-benza ready' as status,
  (select count(*) from information_schema.columns
   where table_schema = 'public' and table_name = 'fuel_entries' and column_name = 'benza_event_key') as has_benza_key,
  (select count(*)::int from information_schema.tables
   where table_schema = 'public' and table_name = 'benza_fuel_pending') as has_pending;
