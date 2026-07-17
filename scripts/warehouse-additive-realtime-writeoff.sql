-- scripts/warehouse-additive-realtime-writeoff.sql
--
-- Переход со списания добавок (ПФМ-НЛК / Линомикс ТипР) пакетно при загрузке
-- отчёта MEKA на списание в реальном времени — в момент, когда конкретный
-- рейс миксера получает статус "Разгружен" (см. lib/orderMixers.ts). Раньше
-- значения из отчёта (кг) вычитались из остатка склада (литры) 1:1, без
-- перевода по плотности — реальный расход был выше показанного на ~16-18%.
--
-- 1) На order_mixers запоминаем, сколько РЕАЛЬНО списано по конкретному
--    рейсу (и какой добавкой) — это даёт возможность точного возврата остатка,
--    если статус миксера отменят/поменяют обратно или сам миксер удалят.
alter table public.order_mixers
  add column if not exists additive_write_off_id numeric,
  add column if not exists additive_write_off_liters numeric,
  add column if not exists additive_write_off_kg numeric;

comment on column public.order_mixers.additive_write_off_id is
  'Какая добавка была списана со склада за этот рейс при разгрузке (1 = ПФМ-НЛК, 2 = Линомикс ТипР). NULL — по рецепту добавка не положена или ещё не списана.';
comment on column public.order_mixers.additive_write_off_liters is
  'Сколько литров реально списано со склада (warehouse_additives.current) за этот рейс — используется для точного возврата при отмене/удалении.';
comment on column public.order_mixers.additive_write_off_kg is
  'То же самое в кг (для истории/сверки с отчётами MEKA) — additive_write_off_liters × плотность.';

-- 2) Атомарная корректировка остатка добавки на складе — избегает гонки
--    «прочитать в клиенте → записать обратно», которая была в
--    /api/adminCifra/warehouse/subtract. Один вызов — один SQL UPDATE.
--    p_delta_liters — со знаком: отрицательное значение списывает,
--    положительное — возвращает (при отмене рейса/удалении миксера).
create or replace function public.warehouse_additive_adjust(
  p_additive_id numeric,
  p_delta_liters numeric
)
returns numeric
language plpgsql
as $$
declare
  v_new_current numeric;
begin
  update public.warehouse_additives
  set current = greatest(0, current + p_delta_liters),
      updated_at = now()
  where additive_id = p_additive_id
  returning current into v_new_current;

  return v_new_current;
end;
$$;

comment on function public.warehouse_additive_adjust(numeric, numeric) is
  'Атомарно изменяет остаток добавки на складе (warehouse_additives.current) на p_delta_liters литров. Используется реальным списанием при разгрузке миксера (lib/orderMixers.ts) и его возвратом при отмене/удалении рейса.';
