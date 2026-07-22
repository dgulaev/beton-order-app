-- Разрешить несколько паспортов на одну заявку.
-- Ошибка: duplicate key value violates unique constraint "uniq_concrete_passports_order"
--
-- Выполнить в Supabase → SQL Editor (один раз).

alter table public.concrete_passports
  drop constraint if exists uniq_concrete_passports_order;

-- На всякий случай, если создавали как unique index, а не constraint:
drop index if exists public.uniq_concrete_passports_order;

-- Обычный (не unique) индекс по order_id оставляем для выборок.
create index if not exists idx_concrete_passports_order_id
  on public.concrete_passports (order_id);
