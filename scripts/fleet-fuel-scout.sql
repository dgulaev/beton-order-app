-- ============================================================
-- Импорт заправок из СКАУТ (fdstat) → fuel_entries
-- Идемпотентно. Требует fuel_entries (fleet-fuel-expenses.sql).
-- ============================================================

alter table public.fuel_entries
  add column if not exists source text not null default 'manual';

alter table public.fuel_entries
  add column if not exists scout_event_key text;

comment on column public.fuel_entries.source is
  'manual | scout | driver';
comment on column public.fuel_entries.scout_event_key is
  'Идемпотентный ключ события СКАУТ (unitId+ts+тип+уровни)';

create unique index if not exists fuel_entries_scout_event_key_uidx
  on public.fuel_entries (scout_event_key)
  where scout_event_key is not null;

-- Проверка
select 'fleet-fuel-scout ready' as status,
  (select count(*) from information_schema.columns
   where table_schema = 'public' and table_name = 'fuel_entries' and column_name = 'scout_event_key') as has_key;
