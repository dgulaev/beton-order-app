-- ============================================================
-- Документы на этапе «Обработка» спроса (до отправки в лиды)
-- + bucket Storage demand-contracts
--
-- КАК ПРИМЕНИТЬ: Supabase SQL Editor → выполнить целиком.
-- Идемпотентно.
-- ============================================================

create table if not exists public.demand_contracts (
  id                bigserial primary key,
  demand_id         bigint not null references public.demand_items(id) on delete cascade,
  file_name         text not null,
  storage_path      text not null unique,
  mime_type         text,
  size_bytes        bigint,
  uploaded_by       bigint,
  uploaded_by_name  text,
  created_at        timestamptz not null default now()
);

create index if not exists demand_contracts_demand_id_idx
  on public.demand_contracts (demand_id, created_at desc);

comment on table public.demand_contracts is
  'Файлы на этапе обработки спроса; при отправке в лиды копируются в lead_contracts';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'demand-contracts',
  'demand-contracts',
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

select 'demand_contracts ready' as status,
  (select count(*)::int from public.demand_contracts) as files_now;
