-- ============================================================
-- Автосброс "кто на смене" в начале нового дня + отдельная метка времени
-- выбора смены (чтобы не путать её с updated_at, который также меняется
-- при редактировании списка имён в карточке "Оператор").
--
-- КАК ПРИМЕНИТЬ:
--   1. Откройте Supabase Dashboard → SQL Editor
--   2. Вставьте и выполните весь скрипт целиком
--   3. В конце вернётся проверочная строка
--
-- Скрипт идемпотентен — можно безопасно запускать повторно.
-- ============================================================

alter table public.operator_shift_settings
  add column if not exists active_operator_set_at timestamptz;

comment on column public.operator_shift_settings.active_operator_set_at is 'Когда именно был выбран текущий active_operator_name — используется, чтобы определить, что выбор сделан не сегодня, и автоматически сбросить его (см. /api/adminCifra/operator-shift).';

-- Если уже есть выбранное имя, но метки времени выбора нет (переход со старой
-- версии таблицы) — используем updated_at как лучшее известное приближение.
update public.operator_shift_settings
set active_operator_set_at = updated_at
where id = 1 and active_operator_name is not null and active_operator_set_at is null;

-- ============================================================
-- Проверочный запрос
-- ============================================================
select * from public.operator_shift_settings where id = 1;
