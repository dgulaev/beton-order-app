-- Фикс внесения при минусе: после фиксации экономии цикл закрывается
-- (база = 0), затем прибавляется поступление.
-- Было: current = -2.4 + 85 = 82.6 (занижение на величину экономии)
-- Стало: current = 0 + 85 = 85
--
-- КАК ПРИМЕНИТЬ: Supabase SQL Editor → выполнить целиком.

create or replace function public.warehouse_silo_book_and_add(
  p_silo_id numeric,
  p_delta_tons numeric,
  p_user_name text default null
)
returns table(
  ok boolean,
  error_text text,
  silo_id numeric,
  saving_kg numeric,
  old_current numeric,
  new_current numeric
)
language plpgsql
as $$
declare
  v_old numeric;
  v_new numeric;
  v_base numeric;
  v_saving_tons numeric;
  v_saving_kg numeric;
begin
  if p_silo_id is null or p_silo_id not in (1, 2, 3) then
    ok := false;
    error_text := 'Некорректный силос';
    return next;
    return;
  end if;

  -- Только поступление (положительное). Списание — другими путями.
  if p_delta_tons is null or p_delta_tons <= 0 then
    ok := false;
    error_text := 'Количество для внесения должно быть > 0';
    silo_id := p_silo_id;
    return next;
    return;
  end if;

  select current into v_old
  from public.warehouse_silos
  where warehouse_silos.silo_id = p_silo_id
  for update;

  if v_old is null then
    ok := false;
    error_text := 'Силос не найден';
    silo_id := p_silo_id;
    return next;
    return;
  end if;

  v_saving_tons := greatest(0, -v_old);
  v_saving_kg := round(v_saving_tons * 1000, 1);

  if v_saving_kg > 0 then
    insert into public.warehouse_cement_savings (
      silo_id, amount_kg, reason, balance_before_tons, user_name
    ) values (
      p_silo_id, v_saving_kg, 'refill', v_old, nullif(trim(p_user_name), '')
    );
  end if;

  -- Закрыть отрицательный цикл (даже «пыль» < 0.05 кг), затем внести
  v_base := greatest(v_old, 0);
  v_new := v_base + p_delta_tons;

  update public.warehouse_silos
  set current = v_new, updated_at = now()
  where warehouse_silos.silo_id = p_silo_id;

  ok := true;
  error_text := null;
  silo_id := p_silo_id;
  saving_kg := v_saving_kg;
  old_current := v_old;
  new_current := v_new;
  return next;
end;
$$;

comment on function public.warehouse_silo_book_and_add(numeric, numeric, text) is
  'Вносит цемент (>0). При минусе до внесения пишет экономию и закрывает цикл (база=0), затем прибавляет поступление.';
