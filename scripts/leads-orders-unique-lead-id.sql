-- Устарело: один лид → один заказ.
-- Теперь 1:N — выполните scripts/leads-fulfillment.sql
-- Этот файл оставлен, чтобы не ломать старые инструкции.

drop index if exists public.orders_lead_id_unique;
