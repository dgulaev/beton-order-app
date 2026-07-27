-- ============================================================
-- Настройки интеграций (Авито, ГосПлан, Demand Radar) — одна строка id=1.
-- Редактируется в админке: /adminCifra/integrations
--
-- КАК ПРИМЕНИТЬ:
--   1. Supabase Dashboard → SQL Editor
--   2. Выполнить весь скрипт
--
-- Приоритет значений: непустое поле в этой таблице → иначе process.env → дефолт.
-- Пустая строка / NULL в БД = «взять из env».
-- Секреты в API наружу не отдаются (только флаги *_set).
--
-- Скрипт идемпотентен.
-- ============================================================

create table if not exists public.integration_settings (
  id                     bigint primary key default 1,

  -- Авито
  avito_enabled          boolean not null default true,
  avito_client_id        text,
  avito_client_secret    text,
  avito_user_id          text,
  avito_webhook_secret   text,

  -- ГосПлан / Demand
  gosplan_enabled        boolean not null default true,
  gosplan_base_url       text,
  gosplan_api_key        text,
  gosplan_regions        text,          -- коды субъектов через запятую, напр. "32"
  demand_demo            boolean not null default false,
  demand_feed_url        text,
  demand_home_regions    text,          -- "брянск,брянская"
  demand_min_volume_m3   numeric,
  demand_alert_score     numeric,

  updated_at             timestamptz not null default now()
);

comment on table public.integration_settings is
  'Секреты и тумблеры интеграций (Авито / ГосПлан / Demand). Одна строка id=1. Читает service_role через /api/adminCifra/integrations.';

insert into public.integration_settings (id)
select 1
where not exists (select 1 from public.integration_settings where id = 1);

alter table public.integration_settings enable row level security;

-- Проверка
select id, avito_enabled, gosplan_enabled, demand_demo,
       (avito_client_secret is not null and length(avito_client_secret) > 0) as avito_secret_set,
       (gosplan_api_key is not null and length(gosplan_api_key) > 0) as gosplan_key_set,
       demand_home_regions, gosplan_regions, updated_at
from public.integration_settings
where id = 1;
