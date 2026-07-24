-- Уточнение порога: алерт при current < -N т (строго больше N тонн в минус).
-- Идемпотентно: можно выполнять поверх warehouse-silo-low-rate-alert.sql

create or replace function public.warehouse_silo_sync_low_rate_alert(
  p_silo_id numeric
)
returns table(
  fired boolean,
  pending boolean,
  silo_id numeric,
  current_tons numeric,
  threshold_tons numeric,
  alert_at timestamptz
)
language plpgsql
as $$
declare
  v_current numeric;
  v_threshold numeric;
  v_alert_at timestamptz;
  v_acked boolean;
  v_name text;
  v_depth_kg numeric;
begin
  if p_silo_id is null or p_silo_id not in (1, 2, 3) then
    fired := false;
    pending := false;
    silo_id := p_silo_id;
    current_tons := null;
    threshold_tons := null;
    alert_at := null;
    return next;
    return;
  end if;

  v_threshold := case when p_silo_id = 3 then 10 else 5 end;

  select
    s.current,
    s.low_rate_alert_at,
    s.low_rate_alert_acked,
    s.name
  into v_current, v_alert_at, v_acked, v_name
  from public.warehouse_silos s
  where s.silo_id = p_silo_id
  for update;

  if v_current is null then
    fired := false;
    pending := false;
    silo_id := p_silo_id;
    current_tons := null;
    threshold_tons := v_threshold;
    alert_at := null;
    return next;
    return;
  end if;

  -- Безопасно: current >= -порог (ровно −5/−10 ещё не алерт)
  if v_current >= -v_threshold then
    if v_alert_at is not null then
      update public.warehouse_silos
      set
        low_rate_alert_at = null,
        low_rate_alert_acked = true,
        updated_at = now()
      where warehouse_silos.silo_id = p_silo_id;
    end if;
    fired := false;
    pending := false;
    silo_id := p_silo_id;
    current_tons := v_current;
    threshold_tons := v_threshold;
    alert_at := null;
    return next;
    return;
  end if;

  if v_alert_at is null then
    v_depth_kg := round(abs(v_current) * 1000, 1);
    update public.warehouse_silos
    set
      low_rate_alert_at = now(),
      low_rate_alert_acked = false,
      updated_at = now()
    where warehouse_silos.silo_id = p_silo_id
    returning low_rate_alert_at into v_alert_at;

    insert into public.warehouse_operations (
      operation_type, item_type, amount, old_value, new_value, unit, user_name
    ) values (
      'alert',
      coalesce(v_name, 'Силос ' || p_silo_id::text),
      v_depth_kg,
      round(v_current * 1000, 1),
      round(v_current * 1000, 1),
      'кг',
      'Расход слишком низкий — проверьте завод!'
    );

    fired := true;
    pending := true;
  else
    fired := false;
    pending := not coalesce(v_acked, false);
  end if;

  silo_id := p_silo_id;
  current_tons := v_current;
  threshold_tons := v_threshold;
  alert_at := v_alert_at;
  return next;
end;
$$;
