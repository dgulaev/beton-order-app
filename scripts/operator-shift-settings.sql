-- ============================================================
-- Модуль «Кто сейчас на смене» (оператор БСУ) — одна строка настроек.
--
-- КАК ПРИМЕНИТЬ:
--   1. Откройте Supabase Dashboard → SQL Editor
--   2. Вставьте и выполните весь скрипт целиком
--   3. В конце вернётся проверочная строка
--
-- ЗАЧЕМ: у оператора БСУ одна общая учётка на двоих (Семён и Максим), чтобы
-- не заставлять их логиниться заново на каждой смене. Эта таблица хранит
-- ТОЛЬКО текущее имя того, кто сейчас за пультом — одна строка (id=1),
-- которая просто перезаписывается (UPDATE) при переключении, без роста
-- таблицы и без создания новых записей/логинов.
--
-- Скрипт идемпотентен — можно безопасно запускать повторно.
-- ============================================================

create table if not exists public.operator_shift_settings (
  id                    bigint primary key default 1,
  active_operator_name  text,
  updated_at            timestamptz not null default now()
);

comment on table public.operator_shift_settings is 'Кто сейчас на смене за пультом оператора БСУ (одна строка, id=1) — общая учётка на двоих, без создания новых записей при переключении.';
comment on column public.operator_shift_settings.active_operator_name is 'Имя оператора, который сейчас работает под общей учёткой (напр. "Семён" или "Максим").';

insert into public.operator_shift_settings (id, active_operator_name)
select 1, null
where not exists (select 1 from public.operator_shift_settings where id = 1);

-- RLS: закрываем от anon-ключа (он уходит в браузер) — по образцу lab_settings.
-- Страница оператора ходит через /api/adminCifra/operator-shift, который
-- работает под service_role и RLS игнорирует.
alter table public.operator_shift_settings enable row level security;

-- ============================================================
-- Проверочный запрос
-- ============================================================
select * from public.operator_shift_settings where id = 1;
