-- ============================================================
-- BROADCAST — fleet_telemetry_snapshots (СКАУТ / карта парка)
--
-- Топик: fleet_telemetry_snapshots:all
-- Использует уже существующую public.broadcast_table_change()
-- (см. scripts/broadcast-order-mixers-setup.sql).
--
-- После sync СКАУТ → upsert snapshots → клиенты с открытой
-- страницей Техника / «Парк на карте» получают UPDATE без polling.
-- ============================================================

-- Нужна функция broadcast_table_change — если её ещё нет, создаём
create or replace function public.broadcast_table_change()
returns trigger
language plpgsql
security definer
as $$
declare
  payload jsonb;
begin
  payload := jsonb_build_object(
    'operation', TG_OP,
    'record', case when TG_OP = 'DELETE' then null else to_jsonb(NEW) end,
    'old',    case when TG_OP = 'INSERT' then null else to_jsonb(OLD) end
  );
  perform realtime.send(payload, TG_OP, TG_TABLE_NAME || ':all', false);
  return null;
end;
$$;

drop trigger if exists fleet_telemetry_snapshots_broadcast on public.fleet_telemetry_snapshots;
create trigger fleet_telemetry_snapshots_broadcast
  after insert or update or delete on public.fleet_telemetry_snapshots
  for each row execute function public.broadcast_table_change();

-- Проверка: обнови GPS («Обновить все GPS») — в консоли страницы Техника
-- должно появиться событие по топику fleet_telemetry_snapshots:all.
select 'fleet_telemetry_snapshots broadcast ready' as status;
