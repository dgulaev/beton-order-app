-- ============================================================
-- Внедрение водителей миксеров — схема БД (этап 0)
--
-- КАК ПРИМЕНИТЬ:
--   1. Откройте Supabase Dashboard → SQL Editor
--   2. Вставьте и выполните весь скрипт целиком
--   3. В конце должны вернуться строки с новыми колонками (блок «5. Проверочные запросы»)
--
-- Все команды идемпотентны — скрипт можно безопасно запускать повторно.
-- ============================================================


-- ============================================================
-- 1) mixers: индивидуальная норма простоя для арендованных миксеров.
--    Для своих миксеров (type = 'own') норма фиксированная — 50 минут,
--    задаётся константой в коде (не в БД). Для наёмных (type = 'rented')
--    норма вводится диспетчером в карточке миксера и хранится здесь.
-- ============================================================
alter table public.mixers
  add column if not exists unload_allowance_min integer;

comment on column public.mixers.unload_allowance_min is
  'Норма времени разгрузки в минутах (только для type=rented). Для own — используется константа 50 из кода.';

-- Для наёмных миксеров норма должна быть положительной (если поле заполнено).
alter table public.mixers drop constraint if exists mixers_unload_allowance_min_positive;
alter table public.mixers add constraint mixers_unload_allowance_min_positive
  check (unload_allowance_min is null or unload_allowance_min > 0);


-- ============================================================
-- 2) order_mixers: фактическое время на объекте + расчётный простой.
--    on_site_at   — водитель нажал «На объекте» (или диспетчер вручную)
--    unloaded_at  — водитель нажал «Разгружен» (или диспетчер вручную)
--    downtime_minutes — max(0, (unloaded_at - on_site_at) в минутах - норма)
-- ============================================================
alter table public.order_mixers
  add column if not exists on_site_at timestamptz,
  add column if not exists unloaded_at timestamptz,
  add column if not exists downtime_minutes numeric;

comment on column public.order_mixers.on_site_at is 'Фактическое время прибытия на объект (фиксируется по кнопке "На объекте")';
comment on column public.order_mixers.unloaded_at is 'Фактическое время окончания разгрузки (фиксируется по кнопке "Разгружен")';
comment on column public.order_mixers.downtime_minutes is 'Расчётный простой на объекте в минутах, сверх нормы разгрузки';

alter table public.order_mixers drop constraint if exists order_mixers_downtime_nonneg;
alter table public.order_mixers add constraint order_mixers_downtime_nonneg
  check (downtime_minutes is null or downtime_minutes >= 0);


-- ============================================================
-- 3) Индекс для быстрого поиска рейсов конкретного миксера
--    (нужен для мобильного кабинета водителя — "Мои рейсы").
-- ============================================================
create index if not exists idx_order_mixers_mixer_name on public.order_mixers (mixer_name);


-- ============================================================
-- 4) Индекс для быстрой авторизации водителя по номеру+телефону.
-- ============================================================
create index if not exists idx_mixers_number_phone on public.mixers (number, phone);


-- ============================================================
-- 5) Проверочные запросы
-- ============================================================
select column_name, data_type from information_schema.columns
where table_schema = 'public' and table_name = 'mixers' and column_name = 'unload_allowance_min';

select column_name, data_type from information_schema.columns
where table_schema = 'public' and table_name = 'order_mixers'
  and column_name in ('on_site_at', 'unloaded_at', 'downtime_minutes');
