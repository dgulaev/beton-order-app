-- ============================================================
-- Оптимизация broadcast: тонкий soft-lock плана + suppress при apply.
--
-- КАК ПРИМЕНИТЬ:
--   Supabase Dashboard → SQL Editor → выполнить целиком.
-- Идемпотентен.
-- ============================================================

-- 1) daily_logistics_plans: soft-lock (только editing_*) → тонкий payload
create or replace function public.broadcast_daily_logistics_plans_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  payload jsonb;
  thin boolean := false;
  rec jsonb;
  old_rec jsonb;
begin
  if TG_OP = 'UPDATE' then
    -- Контент плана не менялся — только «сейчас правит…»
    if (OLD.revision is not distinct from NEW.revision)
       and (OLD.payload is not distinct from NEW.payload)
       and (OLD.max_text is not distinct from NEW.max_text)
       and (OLD.morning_payload is not distinct from NEW.morning_payload)
    then
      thin := true;
    end if;
  end if;

  if thin then
    rec := jsonb_build_object(
      'delivery_date', NEW.delivery_date,
      'revision', NEW.revision,
      'updated_at', NEW.updated_at,
      'updated_by_name', NEW.updated_by_name,
      'updated_by_role', NEW.updated_by_role,
      'updated_by_user_id', NEW.updated_by_user_id,
      'editing_by_name', NEW.editing_by_name,
      'editing_by_user_id', NEW.editing_by_user_id,
      'editing_at', NEW.editing_at,
      '_thin', true
    );
    old_rec := jsonb_build_object(
      'delivery_date', OLD.delivery_date,
      'revision', OLD.revision,
      'editing_by_name', OLD.editing_by_name,
      'editing_by_user_id', OLD.editing_by_user_id,
      'editing_at', OLD.editing_at,
      '_thin', true
    );
  else
    rec := case when TG_OP = 'DELETE' then null else to_jsonb(NEW) end;
    old_rec := case when TG_OP = 'INSERT' then null else to_jsonb(OLD) end;
  end if;

  payload := jsonb_build_object(
    'operation', TG_OP,
    'record', rec,
    'old', old_rec
  );
  perform realtime.send(payload, TG_OP, 'daily_logistics_plans:all', false);
  return null;
end;
$$;

drop trigger if exists daily_logistics_plans_broadcast on public.daily_logistics_plans;
create trigger daily_logistics_plans_broadcast
  after insert or update or delete on public.daily_logistics_plans
  for each row execute function public.broadcast_daily_logistics_plans_change();

-- 2) order_mixers: подавление row-broadcast на время apply + один RELOAD
create or replace function public.broadcast_order_mixers_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  payload jsonb;
begin
  -- Транзакция apply: set_config(..., true) — не шлём N сообщений
  if current_setting('app.suppress_om_broadcast', true) = 'on' then
    return null;
  end if;

  payload := jsonb_build_object(
    'operation', TG_OP,
    'record', case when TG_OP = 'DELETE' then null else to_jsonb(NEW) end,
    'old',    case when TG_OP = 'INSERT' then null else to_jsonb(OLD) end
  );

  -- Только order_mixers:all (персональный order_mixers:<номер> убран —
  -- клиенты не слушали; водитель фильтрует all по mixer_name).
  perform realtime.send(payload, TG_OP, 'order_mixers:all', false);

  return null;
end;
$$;

create or replace function public.notify_order_mixers_reload()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform realtime.send(
    jsonb_build_object(
      'operation', 'RELOAD',
      'record', jsonb_build_object('_reload', true),
      'old', null
    ),
    'RELOAD',
    'order_mixers:all',
    false
  );
end;
$$;

revoke all on function public.notify_order_mixers_reload() from public;
grant execute on function public.notify_order_mixers_reload() to service_role;

-- 3) apply RPC: suppress row-broadcast внутри транзакции
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

  -- Подавить per-row broadcast; клиент получит один RELOAD с API после всех заявок
  perform set_config('app.suppress_om_broadcast', 'on', true);

  if p_delete_ids is not null and coalesce(array_length(p_delete_ids, 1), 0) > 0 then
    delete from public.order_mixers
    where order_id = p_order_id
      and id = any (p_delete_ids);
    get diagnostics v_deleted = row_count;
  end if;

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

comment on function public.broadcast_daily_logistics_plans_change() is
  'Broadcast плана: soft-lock без payload/morning_payload';
comment on function public.notify_order_mixers_reload() is
  'Один сигнал order_mixers:all после apply плана (вместо N row-events)';
