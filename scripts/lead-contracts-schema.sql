-- ============================================================
-- Контракты / файлы по лидам + bucket Storage
--
-- КАК ПРИМЕНИТЬ:
--   1. Supabase Dashboard → SQL Editor
--   2. Выполнить весь скрипт
--
-- Скрипт идемпотентен.
-- ============================================================

create table if not exists public.lead_contracts (
  id                bigserial primary key,
  lead_id           bigint not null references public.leads(id) on delete cascade,
  file_name         text not null,
  storage_path      text not null unique,
  mime_type         text,
  size_bytes        bigint,
  uploaded_by       bigint,
  uploaded_by_name  text,
  created_at        timestamptz not null default now()
);

create index if not exists lead_contracts_lead_id_idx
  on public.lead_contracts (lead_id, created_at desc);

comment on table public.lead_contracts is 'Файлы контрактов и документов по лидам (торги)';

-- Приватный bucket для файлов (service_role обходит RLS)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'lead-contracts',
  'lead-contracts',
  false,
  20971520, -- 20 MB
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'image/png',
    'image/jpeg',
    'image/webp',
    'text/plain'
  ]
)
on conflict (id) do update set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

select 'lead_contracts ready' as status,
  (select count(*)::int from public.lead_contracts) as files_now;
