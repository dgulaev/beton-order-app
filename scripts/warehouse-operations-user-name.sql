-- ============================================================
-- Имя сотрудника в ленте операций склада (warehouse_operations).
--
-- КАК ПРИМЕНИТЬ:
--   1. Откройте Supabase Dashboard → SQL Editor
--   2. Вставьте и выполните весь скрипт целиком
--   3. В конце вернётся проверочный запрос
--
-- ЗАЧЕМ: в UI склада («Лента операций») нужно видеть, кто внёс/списал
-- остаток. Для общей учётки операторов БСУ пишется имя со смены
-- (Семён/Максим), иначе — full_name залогиненного пользователя.
--
-- Старые записи останутся с user_name = null — в UI покажем «—».
-- Скрипт идемпотентен.
-- ============================================================

alter table public.warehouse_operations
  add column if not exists user_name text;

comment on column public.warehouse_operations.user_name is
  'Кто выполнил операцию на складе (имя со смены оператора или full_name). Null для записей до внедрения поля.';

-- ============================================================
-- Проверочный запрос
-- ============================================================
select column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'warehouse_operations'
  and column_name = 'user_name';
