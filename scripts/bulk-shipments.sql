-- Фаза 5: учёт отгрузок инертных/цемента (продажа + перевозка).

create table if not exists public.bulk_shipments (
  id bigserial primary key,
  order_id bigint not null references public.orders(id) on delete cascade,
  loading_point_id bigint references public.loading_points(id),
  vehicle_kind text,
  vehicle_number text,
  volume numeric(12, 3) not null,
  unit text not null default 'm3',
  product_code text,
  shipped_at timestamptz not null default now(),
  notes text,
  created_by bigint,
  created_at timestamptz not null default now(),
  constraint bulk_shipments_volume_check check (volume > 0)
);

create index if not exists bulk_shipments_order_id_idx on public.bulk_shipments (order_id);
create index if not exists bulk_shipments_shipped_at_idx on public.bulk_shipments (shipped_at desc);

comment on table public.bulk_shipments is
  'Отгрузки bulk-заявок (щебень/песок/цемент): объём, техника, точка погрузки.';

-- ── RLS: только service_role через /api/adminCifra/bulk-shipments ──
-- anon-ключ из браузера не получает политик → deny by default.
-- API ходит под SUPABASE_SERVICE_ROLE_KEY и RLS игнорирует.
alter table public.bulk_shipments enable row level security;
