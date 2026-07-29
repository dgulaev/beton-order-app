-- RLS для таблиц модернизации (Техника / точки / конкуренты / bulk).
-- Идемпотентно: можно прогнать на уже существующей БД после create-скриптов.
--
-- Модель (как у lab_settings / leads / delivery_settings):
--   • включаем RLS без anon-политик → браузерный anon-ключ ничего не читает/пишет;
--   • все adminCifra API работают через SUPABASE_SERVICE_ROLE_KEY и RLS обходят.
--
-- Также: partial unique на competitors.parser_key (защита от дубля парсера).

do $$
declare
  t text;
begin
  foreach t in array array[
    'competitors',
    'competitor_price_snapshots',
    'competitor_matrix_columns',
    'loading_points',
    'bulk_shipments'
  ]
  loop
    if exists (
      select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = t and c.relkind = 'r'
    ) then
      execute format('alter table public.%I enable row level security;', t);
    end if;
  end loop;
end $$;

-- Один parser_key → один завод; несколько NULL (ручной ввод) — ок
create unique index if not exists competitors_parser_key_uidx
  on public.competitors (parser_key)
  where parser_key is not null;

-- Не больше одной активной точки «по умолчанию» на kind
create unique index if not exists loading_points_one_default_per_kind_uidx
  on public.loading_points (kind)
  where is_default = true and active = true;

-- Проверка: rowsecurity = true у всех таблиц модернизации
select relname, relrowsecurity as rls_enabled
from pg_class
where relname in (
  'competitors',
  'competitor_price_snapshots',
  'competitor_matrix_columns',
  'loading_points',
  'bulk_shipments'
)
order by relname;
