-- ============================================================
-- Модуль «Лаборатория» — схема БД (этап 1)
--
-- КАК ПРИМЕНИТЬ:
--   1. Откройте Supabase Dashboard → SQL Editor
--   2. Вставьте и выполните весь скрипт целиком
--   3. В конце вернутся проверочные строки (блок «Проверочные запросы»)
--
-- ВАЖНО ПРО СОВМЕСТИМОСТЬ (завод в работе, менеджеры создают заявки):
--   Скрипт делает ТОЛЬКО добавления — новые nullable-колонки и новые
--   таблицы. Существующие колонки recipes/orders не переименовываются и не
--   удаляются, поэтому текущий процесс добавления марки бетона к заказу
--   (orders.grade ↔ recipes.code) продолжит работать без изменений.
--
--   Внешние ключи на recipes/orders НЕ создаются намеренно — типы их
--   первичных ключей в live-базе могут отличаться, а жёсткий FK взял бы
--   блокировку на рабочих таблицах. Связи логические, по id, с индексами.
--
-- Все команды идемпотентны — скрипт можно безопасно запускать повторно.
-- ============================================================


-- ============================================================
-- 1) plants — заводы / БСУ. Пока один завод «Мекка».
-- ============================================================
create table if not exists public.plants (
  id                      bigint generated always as identity primary key,
  name                    text not null,
  code                    text,
  asu_type                text default 'manual',      -- meka / elkon / kip / tts / rifey / manual
  productivity_m3_per_hour numeric,
  is_active               boolean not null default true,
  created_at              timestamptz not null default now()
);

comment on table public.plants is 'Заводы/БСУ. Сейчас один завод «Мекка».';
comment on column public.plants.asu_type is 'Тип АСУ БСУ: meka/elkon/kip/tts/rifey/manual';

-- Сид: единственный завод «Мекка», 100 м³/ч.
insert into public.plants (name, code, asu_type, productivity_m3_per_hour, is_active)
select 'Мекка', 'MEKA', 'meka', 100, true
where not exists (select 1 from public.plants where name = 'Мекка');


-- ============================================================
-- 2) recipes — добавляем характеристики бетона и служебные поля.
--    Все колонки nullable — старые записи и форма заказа не ломаются.
-- ============================================================
alter table public.recipes
  add column if not exists strength_class   text,   -- класс по прочности B, напр. "В22,5"
  add column if not exists frost_resistance text,   -- морозостойкость F, напр. "F150"
  add column if not exists water_resistance text,   -- водонепроницаемость W, напр. "W6"
  add column if not exists slump            text,   -- подвижность П / марка по удобоукладываемости, напр. "П4"
  add column if not exists cement_grade     text,   -- марка цемента
  add column if not exists mix_no           text,   -- № номинального состава (номер рецепта) для паспорта
  add column if not exists group_name       text,   -- группа/папка для каталога (Летние/Зимние/...)
  add column if not exists notes            text,
  add column if not exists created_at       timestamptz default now(),
  add column if not exists updated_at        timestamptz default now();

comment on column public.recipes.strength_class is 'Класс бетона по прочности B (напр. В22,5)';
comment on column public.recipes.frost_resistance is 'Морозостойкость F (напр. F150)';
comment on column public.recipes.water_resistance is 'Водонепроницаемость W (напр. W6)';
comment on column public.recipes.slump is 'Подвижность/марка по удобоукладываемости П (напр. П4)';
comment on column public.recipes.group_name is 'Группа/папка рецептуры для фильтра каталога';


-- ============================================================
-- 3) specifications — спецификации (привязка к заказу + характеристики).
-- ============================================================
create table if not exists public.specifications (
  id               bigint generated always as identity primary key,
  code             text,                    -- код/номер спецификации
  name             text,                    -- наименование
  order_id         bigint,                  -- логическая связь с orders.id (без FK)
  grade            text,                    -- марка (совместимо с recipes.code / orders.grade)
  product_name     text,                    -- продукция (напр. "Бетон B30 М400 ...")
  strength_class   text,
  frost_resistance text,
  water_resistance text,
  slump            text,
  accredited_marking text,                  -- выбранная аккредитованная марка (из выписки Росаккредитации)
  status           text not null default 'active',  -- active / archived
  source           text not null default 'manual',  -- manual / asu
  created_by       bigint,
  created_by_name  text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table public.specifications is 'Спецификации: привязка заказа к продукции/характеристикам/рецептуре.';
comment on column public.specifications.order_id is 'Логическая ссылка на orders.id (без FK — типы PK в live-базе).';

-- Для уже существующей таблицы (live-база): добавляем колонку выбранной
-- аккредитованной марки, чтобы она сохранялась и подставлялась при редактировании.
alter table public.specifications add column if not exists accredited_marking text;

create index if not exists idx_specifications_order_id on public.specifications (order_id);
create index if not exists idx_specifications_status on public.specifications (status);


-- ============================================================
-- 4) specification_recipes — какая рецептура назначена на заводе
--    в рамках спецификации (на будущее — мульти-заводскость).
-- ============================================================
create table if not exists public.specification_recipes (
  id         bigint generated always as identity primary key,
  spec_id    bigint not null references public.specifications(id) on delete cascade,
  plant_id   bigint references public.plants(id) on delete set null,
  recipe_id  bigint,                  -- логическая ссылка на recipes.id (без FK)
  created_at timestamptz not null default now()
);

comment on table public.specification_recipes is 'Сопоставление рецептуры заводу в рамках спецификации.';

create index if not exists idx_spec_recipes_spec_id on public.specification_recipes (spec_id);
create index if not exists idx_spec_recipes_recipe_id on public.specification_recipes (recipe_id);


-- ============================================================
-- 5) recipe_versions — история изменений рецептур (кто/когда/что менял).
-- ============================================================
create table if not exists public.recipe_versions (
  id              bigint generated always as identity primary key,
  recipe_id       bigint not null,         -- логическая ссылка на recipes.id
  version_no      integer,
  snapshot        jsonb,                   -- снимок рецепта ДО изменения
  changed_by      bigint,
  changed_by_name text,
  change_note     text,
  created_at      timestamptz not null default now()
);

comment on table public.recipe_versions is 'История версий рецептур: снимок состояния до изменения.';

create index if not exists idx_recipe_versions_recipe_id on public.recipe_versions (recipe_id, created_at desc);


-- ============================================================
-- 6) recipe_templates + items — шаблоны/группы рецептур
--    для быстрого заполнения (заготовка состава + характеристик).
-- ============================================================
create table if not exists public.recipe_templates (
  id          bigint generated always as identity primary key,
  name        text not null,
  group_name  text,
  payload     jsonb,                    -- заготовка полей рецепта (состав + характеристики)
  is_active   boolean not null default true,
  created_by  bigint,
  created_at  timestamptz not null default now()
);

comment on table public.recipe_templates is 'Шаблоны рецептур для быстрого заполнения/назначения.';

create table if not exists public.recipe_template_items (
  id          bigint generated always as identity primary key,
  template_id bigint not null references public.recipe_templates(id) on delete cascade,
  recipe_id   bigint,                   -- логическая ссылка на recipes.id
  created_at  timestamptz not null default now()
);

comment on table public.recipe_template_items is 'Состав шаблона: рецептуры, входящие в группу/шаблон.';

create index if not exists idx_recipe_template_items_template on public.recipe_template_items (template_id);


-- ============================================================
-- 7) concrete_tests — журнал испытаний партий (контроль прочности 7/28 сут).
-- ============================================================
create table if not exists public.concrete_tests (
  id                 bigint generated always as identity primary key,
  spec_id            bigint references public.specifications(id) on delete set null,
  order_id           bigint,                 -- логическая ссылка на orders.id
  batch_no           text,                   -- номер партии (напр. 2026-0551)
  recipe_code        text,                   -- марка/код (совместимо с recipes.code)
  sample_date        date,                   -- дата изготовления образцов
  test_type          text not null,          -- '7' или '28' (промежуточный/проектный возраст)
  required_strength  numeric,                -- требуемая прочность, МПа
  actual_strength_mpa numeric,               -- фактическая прочность, МПа
  result             text,                   -- pass / fail / pending
  lab_name           text,
  note               text,
  created_by         bigint,
  created_by_name    text,
  created_at         timestamptz not null default now()
);

comment on table public.concrete_tests is 'Журнал испытаний партий: контроль прочности в 7 и 28 суток.';

-- Протокол испытания (по ГОСТ 10180-2012): серия образцов + средние по серии,
-- заключение, реквизиты лаборатории. Хранится как JSONB для гибкости и
-- обратной совместимости (существующие записи журнала не затрагиваются).
alter table public.concrete_tests add column if not exists protocol jsonb;

create index if not exists idx_concrete_tests_order_id on public.concrete_tests (order_id);
create index if not exists idx_concrete_tests_spec_id on public.concrete_tests (spec_id);


-- ============================================================
-- 8) concrete_passports — паспорта качества (для печати).
-- ============================================================
create table if not exists public.concrete_passports (
  id          bigint generated always as identity primary key,
  passport_no text,                          -- номер паспорта/партии (напр. 2026-0551)
  doc_kind    text not null default 'concrete', -- concrete / mortar
  order_id    bigint,                         -- логическая ссылка на orders.id
  spec_id     bigint references public.specifications(id) on delete set null,
  payload     jsonb,                          -- все поля паспорта для печати
  created_by  bigint,
  created_by_name text,
  created_at  timestamptz not null default now()
);

comment on table public.concrete_passports is 'Паспорта качества бетона/раствора для печати. Несколько паспортов на одну заявку (order_id) разрешены.';

-- ВАЖНО: не вешать UNIQUE на order_id — на одну заявку бывает несколько паспортов (по рейсам).
-- Если в БД остался uniq_concrete_passports_order — см. scripts/drop-uniq-concrete-passports-order.sql
alter table public.concrete_passports drop constraint if exists uniq_concrete_passports_order;
drop index if exists public.uniq_concrete_passports_order;

create index if not exists idx_concrete_passports_order_id on public.concrete_passports (order_id);


-- ============================================================
-- 9) accredited_grades — справочник аккредитованных марок (whitelist).
--    Из выписки по декларации ГОСТ 7473-2010 (бетон) и ГОСТ 28013-98 (раствор).
-- ============================================================
create table if not exists public.accredited_grades (
  id               bigint generated always as identity primary key,
  doc_kind         text not null default 'concrete',   -- concrete / mortar
  marking          text not null unique,               -- напр. "В30П3F300W8"
  strength_class   text,                               -- напр. "В30"
  marka            text,                               -- напр. "М400"
  frost_resistance text,
  water_resistance text,
  slump            text,
  gost             text,
  declaration_no   text,
  is_active        boolean not null default true
);

comment on table public.accredited_grades is 'Справочник аккредитованных марок (whitelist из выписки Росаккредитации).';

-- Сид бетона (ГОСТ 7473-2010, декларация РОСС RU Д-RU.РА01.В.50157/23)
insert into public.accredited_grades
  (doc_kind, marking, strength_class, marka, frost_resistance, water_resistance, slump, gost, declaration_no)
values
  ('concrete','В7,5П2F100W4','В7,5','М100','F100','W4','П2','ГОСТ 7473-2010','РОСС RU Д-RU.РА01.В.50157/23'),
  ('concrete','В7,5П3F100W4','В7,5','М100','F100','W4','П3','ГОСТ 7473-2010','РОСС RU Д-RU.РА01.В.50157/23'),
  ('concrete','В7,5П4F100W4','В7,5','М100','F100','W4','П4','ГОСТ 7473-2010','РОСС RU Д-RU.РА01.В.50157/23'),
  ('concrete','В12,5П3F100W4','В12,5','М150','F100','W4','П3','ГОСТ 7473-2010','РОСС RU Д-RU.РА01.В.50157/23'),
  ('concrete','В12,5П4F150W4','В12,5','М150','F150','W4','П4','ГОСТ 7473-2010','РОСС RU Д-RU.РА01.В.50157/23'),
  ('concrete','В15П2F100W4','В15','М200','F100','W4','П2','ГОСТ 7473-2010','РОСС RU Д-RU.РА01.В.50157/23'),
  ('concrete','В15П3F100W4','В15','М200','F100','W4','П3','ГОСТ 7473-2010','РОСС RU Д-RU.РА01.В.50157/23'),
  ('concrete','В15П3F150W6','В15','М200','F150','W6','П3','ГОСТ 7473-2010','РОСС RU Д-RU.РА01.В.50157/23'),
  ('concrete','В15П3F300W8','В15','М200','F300','W8','П3','ГОСТ 7473-2010','РОСС RU Д-RU.РА01.В.50157/23'),
  ('concrete','В15П4F100W4','В15','М200','F100','W4','П4','ГОСТ 7473-2010','РОСС RU Д-RU.РА01.В.50157/23'),
  ('concrete','В15П4F150W6','В15','М200','F150','W6','П4','ГОСТ 7473-2010','РОСС RU Д-RU.РА01.В.50157/23'),
  ('concrete','В20П2F100W4','В20','М250','F100','W4','П2','ГОСТ 7473-2010','РОСС RU Д-RU.РА01.В.50157/23'),
  ('concrete','В20П2F150W6','В20','М250','F150','W6','П2','ГОСТ 7473-2010','РОСС RU Д-RU.РА01.В.50157/23'),
  ('concrete','В20П3F150W4','В20','М250','F150','W4','П3','ГОСТ 7473-2010','РОСС RU Д-RU.РА01.В.50157/23'),
  ('concrete','В20П3F200W6','В20','М250','F200','W6','П3','ГОСТ 7473-2010','РОСС RU Д-RU.РА01.В.50157/23'),
  ('concrete','В20П3F300W8','В20','М250','F300','W8','П3','ГОСТ 7473-2010','РОСС RU Д-RU.РА01.В.50157/23'),
  ('concrete','В20П4F150W4','В20','М250','F150','W4','П4','ГОСТ 7473-2010','РОСС RU Д-RU.РА01.В.50157/23'),
  ('concrete','В22,5П2F150W6','В22,5','М300','F150','W6','П2','ГОСТ 7473-2010','РОСС RU Д-RU.РА01.В.50157/23'),
  ('concrete','В22,5П3F200W6','В22,5','М300','F200','W6','П3','ГОСТ 7473-2010','РОСС RU Д-RU.РА01.В.50157/23'),
  ('concrete','В22,5П3F200W8','В22,5','М300','F200','W8','П3','ГОСТ 7473-2010','РОСС RU Д-RU.РА01.В.50157/23'),
  ('concrete','В22,5П4F300W6','В22,5','М300','F300','W6','П4','ГОСТ 7473-2010','РОСС RU Д-RU.РА01.В.50157/23'),
  ('concrete','В25П2F200W6','В25','М350','F200','W6','П2','ГОСТ 7473-2010','РОСС RU Д-RU.РА01.В.50157/23'),
  ('concrete','В25П3F200W6','В25','М350','F200','W6','П3','ГОСТ 7473-2010','РОСС RU Д-RU.РА01.В.50157/23'),
  ('concrete','В25П3F300W8','В25','М350','F300','W8','П3','ГОСТ 7473-2010','РОСС RU Д-RU.РА01.В.50157/23'),
  ('concrete','В25П4F200W6','В25','М350','F200','W6','П4','ГОСТ 7473-2010','РОСС RU Д-RU.РА01.В.50157/23'),
  ('concrete','В25П4F300W8','В25','М350','F300','W8','П4','ГОСТ 7473-2010','РОСС RU Д-RU.РА01.В.50157/23'),
  ('concrete','В27,5П3F300W8','В27,5','М350','F300','W8','П3','ГОСТ 7473-2010','РОСС RU Д-RU.РА01.В.50157/23'),
  ('concrete','В27,5П4F300W8','В27,5','М350','F300','W8','П4','ГОСТ 7473-2010','РОСС RU Д-RU.РА01.В.50157/23'),
  ('concrete','В30П2F200W8','В30','М400','F200','W8','П2','ГОСТ 7473-2010','РОСС RU Д-RU.РА01.В.50157/23'),
  ('concrete','В30П3F300W8','В30','М400','F300','W8','П3','ГОСТ 7473-2010','РОСС RU Д-RU.РА01.В.50157/23'),
  ('concrete','В30П4F300W8','В30','М400','F300','W8','П4','ГОСТ 7473-2010','РОСС RU Д-RU.РА01.В.50157/23'),
  ('concrete','В35П2F300W10','В35','М450','F300','W10','П2','ГОСТ 7473-2010','РОСС RU Д-RU.РА01.В.50157/23'),
  ('concrete','В35П3F300W8','В35','М450','F300','W8','П3','ГОСТ 7473-2010','РОСС RU Д-RU.РА01.В.50157/23'),
  ('concrete','В35П4F300W8','В35','М450','F300','W8','П4','ГОСТ 7473-2010','РОСС RU Д-RU.РА01.В.50157/23'),
  ('concrete','В40П2F300W10','В40','М500','F300','W10','П2','ГОСТ 7473-2010','РОСС RU Д-RU.РА01.В.50157/23'),
  ('concrete','В40П3F200W10','В40','М500','F200','W10','П3','ГОСТ 7473-2010','РОСС RU Д-RU.РА01.В.50157/23'),
  ('concrete','В40П3F300W10','В40','М500','F300','W10','П3','ГОСТ 7473-2010','РОСС RU Д-RU.РА01.В.50157/23'),
  ('concrete','В40П4F200W10','В40','М500','F200','W10','П4','ГОСТ 7473-2010','РОСС RU Д-RU.РА01.В.50157/23'),
  ('concrete','В45П3F300W12','В45','М600','F300','W12','П3','ГОСТ 7473-2010','РОСС RU Д-RU.РА01.В.50157/23')
on conflict (marking) do nothing;

-- Сид раствора (ГОСТ 28013-98, декларация РОСС RU Д-RU.РА01.В.50158/23).
-- Растворы строительные кладочные на цементном вяжущем — из выписки.
insert into public.accredited_grades
  (doc_kind, marking, strength_class, marka, frost_resistance, water_resistance, slump, gost, declaration_no)
values
  ('mortar','М75Пк3F50',  null, 'М75',  'F50', null, 'Пк3', 'ГОСТ 28013-98','РОСС RU Д-RU.РА01.В.50158/23'),
  ('mortar','М100Пк3F50', null, 'М100', 'F50', null, 'Пк3', 'ГОСТ 28013-98','РОСС RU Д-RU.РА01.В.50158/23'),
  ('mortar','М150Пк3F50', null, 'М150', 'F50', null, 'Пк3', 'ГОСТ 28013-98','РОСС RU Д-RU.РА01.В.50158/23'),
  ('mortar','М200Пк3F50', null, 'М200', 'F50', null, 'Пк3', 'ГОСТ 28013-98','РОСС RU Д-RU.РА01.В.50158/23')
on conflict (marking) do nothing;


-- ============================================================
-- 10) lab_settings — реквизиты организации/лаборатории для паспорта.
--     Одна строка (id=1).
-- ============================================================
create table if not exists public.lab_settings (
  id                     bigint primary key default 1,
  org_name               text,
  org_address            text,
  inn                    text,
  kpp                    text,
  phone                  text,
  director_name          text,
  lab_head_name          text,
  lab_attestat           text,
  aeff_class             text,
  declaration_concrete   text,
  declaration_mortar     text,
  gost_concrete          text,
  gost_mortar            text,
  fsa_url_concrete       text,
  fsa_url_mortar         text,
  pfm_density_kg_per_l   numeric(6, 3) default 1.16,
  linomix_density_kg_per_l numeric(6, 3) default 1.18,
  single_row             boolean not null default true unique,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

comment on table public.lab_settings is 'Реквизиты ООО «ТрейдКом» и лаборатории для паспорта качества.';

insert into public.lab_settings
  (id, org_name, org_address, inn, kpp, phone, director_name, lab_head_name,
   lab_attestat, aeff_class, declaration_concrete, declaration_mortar,
   gost_concrete, gost_mortar, fsa_url_concrete, fsa_url_mortar)
select 1,
  'ООО «ТрейдКом»',
  '241022, г. Брянск, ул. Орловский тупик, 6',
  '3257056152', '325701001', '+7 (4832) 300-424',
  'Карбовская О. В.', 'Фоменко Е. Ю.',
  'Свидетельство об аттестации №914, действует до 12.10.2026',
  'I класс, не более 370 Бк/кг',
  'РОСС RU Д-RU.РА01.В.50157/23',
  'РОСС RU Д-RU.РА01.В.50158/23',
  'ГОСТ 7473-2010', 'ГОСТ 28013-98',
  'https://pub.fsa.gov.ru/rds/declaration/view/18452794/common',
  'https://pub.fsa.gov.ru/rds/declaration/view/18452798/common'
where not exists (select 1 from public.lab_settings where id = 1);

-- Идемпотентно проставляем ссылки на декларации для QR, если строка уже
-- существовала с пустыми значениями (повторный прогон миграции).
update public.lab_settings
set fsa_url_concrete = coalesce(nullif(fsa_url_concrete, ''), 'https://pub.fsa.gov.ru/rds/declaration/view/18452794/common'),
    fsa_url_mortar   = coalesce(nullif(fsa_url_mortar, ''),   'https://pub.fsa.gov.ru/rds/declaration/view/18452798/common')
where id = 1;


-- ============================================================
-- 11) RLS — закрываем новые таблицы от anon-ключа (он уходит в браузер).
--     Все лабораторные API работают через service_role, который RLS
--     игнорирует, а UI лаборатории ходит только через /api/... — прямого
--     доступа anon-клиентом к этим таблицам нет. Поэтому включаем RLS без
--     anon-политик (deny by default) — по образцу таблицы users. Ничего не
--     ломается: сервисные роуты продолжают работать как обычно.
--
--     Таблицу recipes НЕ трогаем — её RLS остаётся как был (мы лишь добавили
--     колонки), чтобы не затронуть текущий процесс заказов.
-- ============================================================
do $$
declare
  t text;
begin
  foreach t in array array[
    'plants', 'specifications', 'specification_recipes', 'recipe_versions',
    'recipe_templates', 'recipe_template_items', 'concrete_tests',
    'concrete_passports', 'accredited_grades', 'lab_settings'
  ]
  loop
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;


-- ============================================================
-- Проверочные запросы
-- ============================================================
select 'plants' as tbl, count(*) from public.plants
union all select 'accredited_grades', count(*) from public.accredited_grades
union all select 'lab_settings', count(*) from public.lab_settings;

select column_name, data_type from information_schema.columns
where table_schema = 'public' and table_name = 'recipes'
  and column_name in ('strength_class','frost_resistance','water_resistance','slump','group_name')
order by column_name;

-- Статус RLS по новым таблицам (rowsecurity = true у всех новых, кроме recipes):
select relname, relrowsecurity as rls_enabled
from pg_class
where relname in (
  'plants','specifications','specification_recipes','recipe_versions',
  'recipe_templates','recipe_template_items','concrete_tests',
  'concrete_passports','accredited_grades','lab_settings','recipes'
)
order by relname;
