-- ============================================================
-- Лиды (inbox), атрибуция заказов, объявления площадок, спрос
--
-- КАК ПРИМЕНИТЬ:
--   1. Откройте Supabase Dashboard → SQL Editor
--   2. Вставьте и выполните весь скрипт целиком
--   3. В конце вернётся проверочный select
--
-- ЗАЧЕМ: фундамент интеграции Авито / inbox лидов / Demand Radar.
-- Скрипт идемпотентен — можно безопасно запускать повторно.
-- ============================================================

-- ── leads ──────────────────────────────────────────────────
create table if not exists public.leads (
  id              bigserial primary key,
  source          text not null,
  external_id     text,
  status          text not null default 'new'
                    check (status in ('new', 'in_progress', 'converted', 'rejected', 'spam')),
  phone           text,
  name            text,
  chat_url        text,
  raw_text        text,
  raw_payload     jsonb,
  grade           text,
  volume_m3       numeric,
  address         text,
  city            text,
  desired_date    date,
  score           integer default 0,
  assigned_to     bigint,
  order_id        bigint references public.orders(id) on delete set null,
  listing_id      text,
  notified_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create unique index if not exists leads_source_external_id_uidx
  on public.leads (source, external_id)
  where external_id is not null;

create index if not exists leads_status_created_idx
  on public.leads (status, created_at desc);

create index if not exists leads_source_idx on public.leads (source);

comment on table public.leads is 'Входящие лиды с площадок (Авито и др.) до конверсии в заказ';
comment on column public.leads.external_id is 'Идемпотентный ключ площадки (chat_id + message_id и т.п.)';
comment on column public.leads.raw_payload is 'Сырой JSON от webhook/API площадки';

-- ── клиенты-спам (из лидов public_form) ────────────────────
alter table public.users
  add column if not exists is_spam boolean not null default false;

create index if not exists users_client_is_spam_idx
  on public.users (is_spam)
  where role = 'client';

-- ── атрибуция в orders ─────────────────────────────────────
alter table public.orders add column if not exists lead_id bigint references public.leads(id) on delete set null;
alter table public.orders add column if not exists lead_source text;
alter table public.orders add column if not exists external_ref text;

comment on column public.orders.lead_id is 'Ссылка на лид, из которого создан заказ';
comment on column public.orders.lead_source is 'Источник лида (avito, site, tender, …)';
comment on column public.orders.external_ref is 'Внешний id объявления/чата на площадке';

create index if not exists orders_lead_id_idx on public.orders (lead_id);

-- Один лид → один заказ (защита от гонки двойной конверсии)
create unique index if not exists orders_lead_id_unique
  on public.orders (lead_id)
  where lead_id is not null;

-- ── marketplace_listings ───────────────────────────────────
create table if not exists public.marketplace_listings (
  id              bigserial primary key,
  source          text not null default 'avito',
  external_id     text not null,
  title           text,
  description     text,
  price           numeric,
  status          text not null default 'active',
  url             text,
  category        text,
  city            text,
  views           integer default 0,
  contacts        integer default 0,
  template_key    text,
  raw_payload     jsonb,
  last_synced_at  timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (source, external_id)
);

comment on table public.marketplace_listings is 'Объявления на внешних площадках (Авито и др.), синхронизация из админки';

-- ── marketplace_listing_templates ──────────────────────────
create table if not exists public.marketplace_listing_templates (
  key           text primary key,
  title         text not null,
  description   text not null,
  price         numeric not null check (price >= 0),
  grade         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.marketplace_listing_templates is
  'Переопределения шаблонов объявлений Авито; если ключа нет — дефолт из кода';

-- ── demand_items ───────────────────────────────────────────
create table if not exists public.demand_items (
  id                bigserial primary key,
  source            text not null,
  external_id       text,
  external_url      text,
  title             text not null,
  body              text,
  region            text,
  published_at      timestamptz,
  volume_m3         numeric,
  grades            text[],
  delivery_needed   boolean,
  buyer_type        text,
  fit_score         integer default 0,
  status            text not null default 'new'
                      check (status in ('new', 'relevant', 'ignored', 'taken')),
  lead_id           bigint references public.leads(id) on delete set null,
  raw_payload       jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create unique index if not exists demand_items_source_external_id_uidx
  on public.demand_items (source, external_id)
  where external_id is not null;

create index if not exists demand_items_status_score_idx
  on public.demand_items (status, fit_score desc, created_at desc);

comment on table public.demand_items is 'Найденный спрос на бетон (тендеры, запросы) для Demand Radar';

-- ── updated_at helper ──────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  NEW.updated_at := now();
  return NEW;
end;
$$;

drop trigger if exists leads_set_updated_at on public.leads;
create trigger leads_set_updated_at
  before update on public.leads
  for each row execute function public.set_updated_at();

drop trigger if exists marketplace_listings_set_updated_at on public.marketplace_listings;
create trigger marketplace_listings_set_updated_at
  before update on public.marketplace_listings
  for each row execute function public.set_updated_at();

drop trigger if exists marketplace_listing_templates_set_updated_at
  on public.marketplace_listing_templates;
create trigger marketplace_listing_templates_set_updated_at
  before update on public.marketplace_listing_templates
  for each row execute function public.set_updated_at();

drop trigger if exists demand_items_set_updated_at on public.demand_items;
create trigger demand_items_set_updated_at
  before update on public.demand_items
  for each row execute function public.set_updated_at();

-- ── RLS: только service_role через API ─────────────────────
alter table public.leads enable row level security;
alter table public.marketplace_listings enable row level security;
alter table public.marketplace_listing_templates enable row level security;
alter table public.demand_items enable row level security;

-- ── Realtime publication + broadcast ───────────────────────
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'leads'
  ) then
    alter publication supabase_realtime add table public.leads;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'demand_items'
  ) then
    alter publication supabase_realtime add table public.demand_items;
  end if;
end $$;

alter table public.leads REPLICA IDENTITY FULL;
alter table public.demand_items REPLICA IDENTITY FULL;

-- Использует существующую broadcast_table_change() из broadcast-order-mixers-setup.sql
-- (топик leads:all / demand_items:all). Если функции ещё нет — создаём.
create or replace function public.broadcast_table_change()
returns trigger
language plpgsql
security definer
as $$
declare
  payload jsonb;
begin
  payload := jsonb_build_object(
    'operation', TG_OP,
    'record', case when TG_OP = 'DELETE' then null else to_jsonb(NEW) end,
    'old',    case when TG_OP = 'INSERT' then null else to_jsonb(OLD) end
  );
  perform realtime.send(payload, TG_OP, TG_TABLE_NAME || ':all', false);
  return null;
end;
$$;

drop trigger if exists leads_broadcast on public.leads;
create trigger leads_broadcast
  after insert or update or delete on public.leads
  for each row execute function public.broadcast_table_change();

drop trigger if exists demand_items_broadcast on public.demand_items;
create trigger demand_items_broadcast
  after insert or update or delete on public.demand_items
  for each row execute function public.broadcast_table_change();

-- ============================================================
-- Проверка
-- ============================================================
select 'leads' as tbl, count(*)::text as rows from public.leads
union all
select 'marketplace_listings', count(*)::text from public.marketplace_listings
union all
select 'demand_items', count(*)::text from public.demand_items
union all
select 'orders.lead_id', case when exists (
  select 1 from information_schema.columns
  where table_schema = 'public' and table_name = 'orders' and column_name = 'lead_id'
) then 'ok' else 'missing' end;
