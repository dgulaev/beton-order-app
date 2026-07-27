-- ============================================================
-- Заявки на новые интеграции (площадки).
-- Менеджер заводит карточку в админке → разработчик подключает adapter + секреты в коде.
--
-- КАК ПРИМЕНИТЬ: Supabase → SQL Editor → выполнить скрипт.
-- Скрипт идемпотентен.
-- ============================================================

create table if not exists public.integration_requests (
  id                   bigserial primary key,
  -- стабильный ключ площадки (латиница): youla, cian, avito_2 …
  source_key           text not null,
  title                text not null,
  kind                 text not null default 'marketplace'
                       check (kind in ('marketplace', 'demand', 'other')),
  status               text not null default 'requested'
                       check (status in ('requested', 'in_progress', 'wired', 'cancelled')),
  -- что нужно от площадки / кабинета
  notes                text,
  -- ожидаемые env / поля секретов (подсказка для разработки)
  credentials_hint     text,
  docs_url             text,
  account_info         text,
  created_by           bigint references public.users(user_id) on delete set null,
  created_by_name      text,
  updated_at           timestamptz not null default now(),
  created_at           timestamptz not null default now(),
  constraint integration_requests_source_key_unique unique (source_key)
);

comment on table public.integration_requests is
  'Заявки на подключение площадок. Секреты сюда не пишем — только ТЗ; ключи в env/integration_settings + adapter в коде.';

create index if not exists integration_requests_status_idx
  on public.integration_requests (status, created_at desc);

alter table public.integration_requests enable row level security;

-- Проверка
select id, source_key, title, kind, status, created_at
from public.integration_requests
order by id desc
limit 5;
