-- ============================================================
-- BROADCAST FROM DATABASE — полная настройка
--
-- Заменяет postgres_changes-подписки на broadcast во всём приложении.
-- Триггеры шлют сообщения через realtime.send(..., private => false)
-- (публичный broadcast, anon получает без RLS-авторизации).
--
-- Топики:
--   orders:all              — все изменения заявок (админка, дашборд, мобильная, календарь)
--   order_mixers:all        — все изменения рейсов (оператор, дашборд)
--   order_mixers:<номер>    — рейсы конкретного миксера (кабинет водителя)
--   production_logs:all     — лента отгрузок (оператор БСУ)
--
-- В триггере OLD/NEW всегда содержат ВСЕ поля строки (в отличие от
-- postgres_changes, где old зависит от REPLICA IDENTITY) — сравнение
-- старых значений в уведомлениях работает надёжно.
-- ============================================================

-- 1) Универсальная функция для таблиц с одним глобальным топиком <table>:all
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

-- 2) Функция для order_mixers — шлёт И в глобальный топик, И в топик миксера
create or replace function public.broadcast_order_mixers_change()
returns trigger
language plpgsql
security definer
as $$
declare
  mixer text;
  payload jsonb;
begin
  payload := jsonb_build_object(
    'operation', TG_OP,
    'record', case when TG_OP = 'DELETE' then null else to_jsonb(NEW) end,
    'old',    case when TG_OP = 'INSERT' then null else to_jsonb(OLD) end
  );

  -- Глобальный топик — для оператора и дашборда
  perform realtime.send(payload, TG_OP, 'order_mixers:all', false);

  -- Топик конкретного миксера — для кабинета водителя
  mixer := coalesce(NEW.mixer_name, OLD.mixer_name);
  if mixer is not null then
    perform realtime.send(payload, TG_OP, 'order_mixers:' || mixer, false);
  end if;

  return null;
end;
$$;

-- 3) Триггеры
drop trigger if exists orders_broadcast on public.orders;
create trigger orders_broadcast
  after insert or update or delete on public.orders
  for each row execute function public.broadcast_table_change();

drop trigger if exists order_mixers_broadcast on public.order_mixers;
create trigger order_mixers_broadcast
  after insert or update or delete on public.order_mixers
  for each row execute function public.broadcast_order_mixers_change();

drop trigger if exists production_logs_broadcast on public.production_logs;
create trigger production_logs_broadcast
  after insert or update or delete on public.production_logs
  for each row execute function public.broadcast_table_change();

-- ============================================================
-- Проверка: смени статус заявки/рейса — в консоли соответствующей
-- страницы должно появиться событие 📩 [Broadcast].
-- ============================================================
