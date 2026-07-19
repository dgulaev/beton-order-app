-- ============================================================
-- Настройки тарифов доставки бетона — одна строка (id=1), редактируется
-- только админом на отдельной вкладке страницы «Миксеры» → «Тарифы доставки».
--
-- КАК ПРИМЕНИТЬ:
--   1. Откройте Supabase Dashboard → SQL Editor
--   2. Вставьте и выполните весь скрипт целиком
--   3. В конце вернётся проверочная строка
--
-- ЗАЧЕМ: раньше константы доставки (6000₽, 7500₽, 600₽/м³ и т.п.) были
-- захардкожены сразу в трёх разных формах создания заявки (админка,
-- мобильная админка, клиентская страница заказа) — правка цены требовала
-- лезть в код и деплоить. Теперь все они читают одну таблицу через
-- /api/adminCifra/delivery-settings (см. lib/deliveryPricing.ts).
--
-- ФОРМУЛА (см. lib/deliveryPricing.ts calculateDeliveryCost):
--   • объём ≤ 10 м³            → price_tier_10 ₽ за рейс
--   • 10 < объём ≤ 12 м³       → price_tier_12 ₽ за рейс (мощнее миксер)
--   • 12 < объём ≤ 50 м³       → ceil(объём / 10) рейсов × price_tier_trip ₽
--   • объём > 50 м³            → price_per_m3_over_50 ₽ за 1 м³
--   • адрес ЗА ПРЕДЕЛАМИ Брянска (см. isOutsideBryansk в lib/yandexRoute.ts) —
--     ПОЛНОСТЬЮ заменяет тарифы выше: расстояние по прямой (координаты завода
--     ↔ геокодированный адрес) × road_curvature_coefficient (поправка на то,
--     что реальная дорога длиннее прямой) × price_per_km ₽/км, умноженное на
--     количество рейсов (ceil(объём / 10) — каждый миксер реально едет туда
--     и обратно).
--
-- Скрипт идемпотентен — можно безопасно запускать повторно.
-- ============================================================

create table if not exists public.delivery_settings (
  id                          bigint primary key default 1,
  price_tier_10               numeric not null default 6000,   -- ₽ за рейс, объём ≤ 10 м³ (в черте Брянска)
  price_tier_12               numeric not null default 7500,   -- ₽ за рейс, объём 10–12 м³
  price_tier_trip             numeric not null default 6000,   -- ₽ за рейс (по 10 м³) для объёма 12–50 м³
  price_per_m3_over_50        numeric not null default 600,    -- ₽ за 1 м³, объём > 50 м³
  price_per_km                numeric not null default 300,    -- ₽ за 1 км в одну сторону — доставка за пределами Брянска
  road_curvature_coefficient  numeric not null default 1.3,    -- поправка: прямая (по координатам) × коэффициент ≈ реальный путь по дорогам
  updated_at                   timestamptz not null default now()
);

comment on table public.delivery_settings is 'Тарифы расчёта стоимости доставки бетона — одна строка (id=1), редактируется только админом (вкладка «Тарифы доставки» на странице «Миксеры»).';
comment on column public.delivery_settings.price_tier_10 is '₽ за рейс при объёме ≤ 10 м³ (в черте Брянска).';
comment on column public.delivery_settings.price_tier_12 is '₽ за рейс при объёме 10–12 м³ (в черте Брянска).';
comment on column public.delivery_settings.price_tier_trip is '₽ за один рейс (по 10 м³) при объёме 12–50 м³ (в черте Брянска).';
comment on column public.delivery_settings.price_per_m3_over_50 is '₽ за 1 м³ при объёме > 50 м³ (в черте Брянска).';
comment on column public.delivery_settings.price_per_km is '₽ за 1 км пути в одну сторону — доставка за пределами Брянска (умножается на количество рейсов).';
comment on column public.delivery_settings.road_curvature_coefficient is 'Поправочный коэффициент: расстояние по прямой между координатами завода и адреса умножается на него, чтобы приблизить к реальной длине пути по дорогам.';

insert into public.delivery_settings (id)
select 1
where not exists (select 1 from public.delivery_settings where id = 1);

-- RLS: закрываем от anon-ключа (он уходит в браузер) — по образцу lab_settings
-- и operator_shift_settings. Страница читает/пишет через
-- /api/adminCifra/delivery-settings, который работает под service_role и
-- RLS игнорирует.
alter table public.delivery_settings enable row level security;

-- ============================================================
-- Проверочный запрос
-- ============================================================
select * from public.delivery_settings where id = 1;
