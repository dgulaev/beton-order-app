-- ============================================================
-- Атомарный перенос списания цемента между силосами (один рейс).
--
-- КАК ПРИМЕНИТЬ:
--   Supabase Dashboard → SQL Editor → выполнить скрипт целиком.
--
-- ЗАЧЕМ: перенос «Исправить силос» должен в одной транзакции
--   1) залочить рейс и оба силоса,
--   2) вернуть кг на ошибочный силос,
--   3) списать с правильного,
--   4) обновить cement_write_off_silo_id.
-- Без этого при обрыве между шагами остатки и метка расходятся.
-- ============================================================

create or replace function public.warehouse_cement_transfer_silo(
  p_mixer_id bigint,
  p_to_silo_id numeric
)
returns table(
  ok boolean,
  error_text text,
  order_id bigint,
  from_silo_id numeric,
  to_silo_id numeric,
  cement_kg numeric,
  from_old_tons numeric,
  from_new_tons numeric,
  to_old_tons numeric,
  to_new_tons numeric
)
language plpgsql
as $$
declare
  v_order_id bigint;
  v_from_silo numeric;
  v_kg numeric;
  v_tons numeric;
  v_from_old numeric;
  v_from_new numeric;
  v_to_old numeric;
  v_to_new numeric;
  v_first numeric;
  v_second numeric;
  v_first_old numeric;
  v_second_old numeric;
begin
  if p_to_silo_id is null or p_to_silo_id not in (1, 2, 3) then
    ok := false;
    error_text := 'Некорректный целевой силос';
    return next;
    return;
  end if;

  select
    om.order_id,
    om.cement_write_off_silo_id,
    om.cement_write_off_kg
  into v_order_id, v_from_silo, v_kg
  from public.order_mixers om
  where om.id = p_mixer_id
  for update;

  if not found then
    ok := false;
    error_text := 'Рейс не найден';
    return next;
    return;
  end if;

  if v_from_silo is null or v_kg is null or v_kg <= 0 or v_from_silo not in (1, 2, 3) then
    ok := false;
    error_text := 'Нет записанного списания цемента';
    order_id := v_order_id;
    from_silo_id := v_from_silo;
    to_silo_id := p_to_silo_id;
    cement_kg := coalesce(v_kg, 0);
    return next;
    return;
  end if;

  if v_from_silo = p_to_silo_id then
    ok := false;
    error_text := 'Уже на целевом силосе';
    order_id := v_order_id;
    from_silo_id := v_from_silo;
    to_silo_id := p_to_silo_id;
    cement_kg := round(v_kg::numeric, 1);
    return next;
    return;
  end if;

  v_kg := round(v_kg::numeric, 1);
  v_tons := v_kg / 1000.0;

  -- Блокируем силосы в стабильном порядке (анти-deadlock)
  if v_from_silo < p_to_silo_id then
    v_first := v_from_silo;
    v_second := p_to_silo_id;
  else
    v_first := p_to_silo_id;
    v_second := v_from_silo;
  end if;

  select current into v_first_old
  from public.warehouse_silos
  where silo_id = v_first
  for update;

  if v_first_old is null then
    raise exception 'Силос % не найден', v_first;
  end if;

  select current into v_second_old
  from public.warehouse_silos
  where silo_id = v_second
  for update;

  if v_second_old is null then
    raise exception 'Силос % не найден', v_second;
  end if;

  -- Текущие остатки до изменений (в нужном смысле from/to)
  if v_from_silo = v_first then
    v_from_old := v_first_old;
    v_to_old := v_second_old;
  else
    v_from_old := v_second_old;
    v_to_old := v_first_old;
  end if;

  update public.warehouse_silos
  set current = current + v_tons, updated_at = now()
  where silo_id = v_from_silo
  returning current into v_from_new;

  update public.warehouse_silos
  set current = current - v_tons, updated_at = now()
  where silo_id = p_to_silo_id
  returning current into v_to_new;

  update public.order_mixers
  set cement_write_off_silo_id = p_to_silo_id
  where id = p_mixer_id
    and cement_write_off_silo_id = v_from_silo
    and cement_write_off_kg is not null;

  if not found then
    raise exception 'Рейс уже изменён другим действием';
  end if;

  ok := true;
  error_text := null;
  order_id := v_order_id;
  from_silo_id := v_from_silo;
  to_silo_id := p_to_silo_id;
  cement_kg := v_kg;
  from_old_tons := v_from_old;
  from_new_tons := v_from_new;
  to_old_tons := v_to_old;
  to_new_tons := v_to_new;
  return next;
end;
$$;

comment on function public.warehouse_cement_transfer_silo(bigint, numeric) is
  'Атомарно переносит уже записанное списание цемента рейса с одного силоса на другой.';

-- Проверка
select
  proname,
  pg_get_function_identity_arguments(oid) as args
from pg_proc
where pronamespace = 'public'::regnamespace
  and proname = 'warehouse_cement_transfer_silo';
