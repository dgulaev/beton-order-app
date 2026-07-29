-- ============================================================
-- Клиенты под обзвон (победители торгов / строительные объекты)
--
-- КАК ПРИМЕНИТЬ: Supabase SQL Editor → выполнить целиком.
-- Идемпотентно.
-- ============================================================

-- Карточка потенциального клиента (победитель / поставщик)
create table if not exists public.callout_prospects (
  id                 bigserial primary key,
  inn                text,
  organization_name  text,
  phone              text,
  email              text,
  address            text,
  status             text not null default 'new'
                       check (status in ('new', 'in_progress', 'called', 'rejected', 'converted')),
  matched_client_id  bigint references public.users(user_id) on delete set null,
  source             text not null default 'manual',
  assigned_to        bigint,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create unique index if not exists callout_prospects_inn_uidx
  on public.callout_prospects (inn)
  where inn is not null and length(trim(inn)) > 0;

create index if not exists callout_prospects_status_idx
  on public.callout_prospects (status, updated_at desc);

comment on table public.callout_prospects is
  'Потенциальные клиенты под обзвон (победители торгов), дедуп по ИНН';

-- Закупка / объект, привязанный к карточке обзвона (1 победитель → N объектов)
create table if not exists public.callout_tenders (
  id                 bigserial primary key,
  prospect_id        bigint references public.callout_prospects(id) on delete set null,
  lead_id            bigint references public.leads(id) on delete set null,
  purchase_url       text,
  purchase_number    text,
  law                text,
  object_info        text,
  customer_name      text,
  nmck               numeric,
  contract_price     numeric,
  deadline           date,
  contract_reg_num   text,
  raw_contacts       text,
  winner_status      text not null default 'pending'
                       check (winner_status in ('pending', 'found', 'missing', 'manual', 'failed')),
  winner_poll_after  timestamptz,
  winner_checked_at  timestamptz,
  winner_attempts    integer not null default 0,
  source             text not null default 'manual',
  import_batch       text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists callout_tenders_prospect_idx
  on public.callout_tenders (prospect_id);

create index if not exists callout_tenders_purchase_number_idx
  on public.callout_tenders (purchase_number)
  where purchase_number is not null;

create index if not exists callout_tenders_poll_idx
  on public.callout_tenders (winner_status, winner_poll_after)
  where winner_status = 'pending';

create index if not exists callout_tenders_import_batch_idx
  on public.callout_tenders (import_batch)
  where import_batch is not null;

create index if not exists callout_tenders_lead_id_idx
  on public.callout_tenders (lead_id)
  where lead_id is not null;

comment on table public.callout_tenders is
  'Наблюдаемые закупки ЕИС; после контракта связываются с callout_prospects';

-- Комментарии / обратная связь по обзвону
create table if not exists public.callout_comments (
  id            bigserial primary key,
  prospect_id   bigint not null references public.callout_prospects(id) on delete cascade,
  user_id       bigint,
  user_name     text,
  user_role     text,
  body          text not null,
  created_at    timestamptz not null default now()
);

create index if not exists callout_comments_prospect_idx
  on public.callout_comments (prospect_id, created_at desc);

comment on table public.callout_comments is 'Комментарии менеджеров по обзвону';

select 'callout schema ready' as status;
