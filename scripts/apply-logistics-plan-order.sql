-- ============================================================
-- Атомарное применение плана интеллекта к одной заявке (order_mixers).
-- delete editable + insert новых + (опц.) статус заявки + история
-- в одной транзакции функции.
--
-- КАК ПРИМЕНИТЬ:
--   Supabase Dashboard → SQL Editor → выполнить скрипт целиком.
-- Идемпотентен (create or replace).
-- ============================================================

create or replace function public.apply_logistics_plan_trips(
  p_order_id bigint,
  p_delete_ids bigint[],
  p_insert jsonb,
  p_set_processing boolean default false,
  p_clear_questionable boolean default false,
  p_actor_name text default 'Диспетчер',
  p_actor_role text default 'dispatcher',
  p_history_action text default null,
  p_extra_history jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted int := 0;
  v_inserted jsonb := '[]'::jsonb;
  v_item jsonb;
  v_id bigint;
  v_len int;
  i int;
  v_extra jsonb;
begin
  if p_order_id is null or p_order_id <= 0 then
    raise exception 'invalid order_id';
  end if;

  -- 1) Удалить незащищённые рейсы (только этой заявки)
  if p_delete_ids is not null and coalesce(array_length(p_delete_ids, 1), 0) > 0 then
    delete from public.order_mixers
    where order_id = p_order_id
      and id = any (p_delete_ids);
    get diagnostics v_deleted = row_count;
  end if;

  -- 2) Вставить плановые рейсы
  v_len := coalesce(jsonb_array_length(p_insert), 0);
  for i in 0 .. v_len - 1 loop
    v_item := p_insert -> i;
    insert into public.order_mixers (
      order_id,
      mixer_name,
      time,
      volume,
      sort_order,
      status
    )
    values (
      p_order_id,
      trim(both from coalesce(v_item->>'mixer_name', '')),
      coalesce(v_item->>'time', ''),
      coalesce((v_item->>'volume')::numeric, 0),
      coalesce((v_item->>'sort_order')::int, i + 1),
      'Загрузка'
    )
    returning id into v_id;

    v_inserted := v_inserted || jsonb_build_array(
      jsonb_build_object(
        'id', v_id,
        'plan_trip_id', nullif(v_item->>'plan_trip_id', ''),
        'mixer_name', v_item->>'mixer_name',
        'time', v_item->>'time',
        'volume', (v_item->>'volume')::numeric
      )
    );
  end loop;

  -- 3) Статус заявки new → processing (если нужно)
  if p_set_processing then
    update public.orders
    set
      status = 'processing',
      is_questionable = case
        when p_clear_questionable then false
        else is_questionable
      end
    where id = p_order_id
      and status = 'new';
  end if;

  -- 4) История
  if p_history_action is not null and length(trim(p_history_action)) > 0 then
    insert into public.order_history (order_id, action, user_name, user_role)
    values (p_order_id, p_history_action, p_actor_name, p_actor_role);
  end if;

  if p_extra_history is not null and jsonb_typeof(p_extra_history) = 'array' then
    for i in 0 .. coalesce(jsonb_array_length(p_extra_history), 0) - 1 loop
      v_extra := p_extra_history -> i;
      insert into public.order_history (
        order_id,
        action,
        user_name,
        user_role,
        field_name,
        old_value,
        new_value
      )
      values (
        p_order_id,
        coalesce(v_extra->>'action', ''),
        coalesce(nullif(v_extra->>'user_name', ''), 'Система'),
        coalesce(nullif(v_extra->>'user_role', ''), 'system'),
        nullif(v_extra->>'field_name', ''),
        nullif(v_extra->>'old_value', ''),
        nullif(v_extra->>'new_value', '')
      );
    end loop;
  end if;

  return jsonb_build_object(
    'deleted', v_deleted,
    'inserted', v_inserted
  );
end;
$$;

comment on function public.apply_logistics_plan_trips(
  bigint, bigint[], jsonb, boolean, boolean, text, text, text, jsonb
) is
  'Атомарно: удалить editable order_mixers + вставить план + опц. статус/история.';

revoke all on function public.apply_logistics_plan_trips(
  bigint, bigint[], jsonb, boolean, boolean, text, text, text, jsonb
) from public;

grant execute on function public.apply_logistics_plan_trips(
  bigint, bigint[], jsonb, boolean, boolean, text, text, text, jsonb
) to service_role;
