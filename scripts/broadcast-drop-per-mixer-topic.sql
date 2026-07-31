-- ============================================================
-- Убрать мёртвый второй send order_mixers:<номер>.
-- Клиенты слушают только order_mixers:all (водитель фильтрует по mixer_name).
--
-- КАК ПРИМЕНИТЬ:
--   Supabase Dashboard → SQL Editor → выполнить целиком.
-- Идемпотентен (create or replace).
-- ============================================================

create or replace function public.broadcast_order_mixers_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  payload jsonb;
begin
  if current_setting('app.suppress_om_broadcast', true) = 'on' then
    return null;
  end if;

  payload := jsonb_build_object(
    'operation', TG_OP,
    'record', case when TG_OP = 'DELETE' then null else to_jsonb(NEW) end,
    'old',    case when TG_OP = 'INSERT' then null else to_jsonb(OLD) end
  );

  perform realtime.send(payload, TG_OP, 'order_mixers:all', false);

  return null;
end;
$$;
