-- ============================================================
-- Алерт «расход слишком низкий» при глубоком минусе силоса.
-- Силос 1/2: current < -5 т; силос 3: current < -10 т.
-- Срабатывает однократно за «эпизод» минуса; после ack не всплывает
-- при обновлении страницы, пока силос не выйдет из зоны порога.
--
-- КАК ПРИМЕНИТЬ: Supabase SQL Editor → выполнить целиком.
-- ============================================================

alter table public.warehouse_silos
  add column if not exists low_rate_alert_at timestamptz,
  add column if not exists low_rate_alert_acked boolean not null default true;

comment on column public.warehouse_silos.low_rate_alert_at is
  'Когда зафиксирован алерт глубокого минуса (NULL — эпизод не активен).';
comment on column public.warehouse_silos.low_rate_alert_acked is
  'true — UI уже подтвердил алерт (не показывать снова до сброса эпизода).';

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

  -- Вышли из опасной зоны — сброс эпизода (можно снова алертить позже).
  -- Алерт только при current < -порог («больше чем на N тонн» в минус).
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

  -- Глубокий минус
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

comment on function public.warehouse_silo_sync_low_rate_alert(numeric) is
  'Синхронизирует алерт глубокого минуса силоса: однократный fire + pending до ack.';

create or replace function public.warehouse_silo_ack_low_rate_alert(
  p_silo_id numeric
)
returns table(ok boolean, error_text text)
language plpgsql
as $$
begin
  if p_silo_id is null or p_silo_id not in (1, 2, 3) then
    ok := false;
    error_text := 'Некорректный силос';
    return next;
    return;
  end if;

  update public.warehouse_silos
  set low_rate_alert_acked = true, updated_at = now()
  where silo_id = p_silo_id
    and low_rate_alert_at is not null;

  ok := true;
  error_text := null;
  return next;
end;
$$;

-- Проверка
select column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'warehouse_silos'
  and column_name like 'low_rate%'
union all
select proname, pg_get_function_identity_arguments(oid)
from pg_proc
where pronamespace = 'public'::regnamespace
  and proname in (
    'warehouse_silo_sync_low_rate_alert',
    'warehouse_silo_ack_low_rate_alert'
  );
