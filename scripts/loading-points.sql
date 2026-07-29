-- Фаза 2: справочник точек погрузки + поля на заявке.

create table if not exists public.loading_points (
  id bigserial primary key,
  name text not null,
  kind text not null,
  ownership text not null default 'own',
  address text,
  lat double precision,
  lon double precision,
  is_default boolean not null default false,
  active boolean not null default true,
  notes text,
  external_key text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint loading_points_kind_check check (
    kind = any (array['concrete'::text, 'aggregate'::text, 'cement'::text, 'mixed'::text])
  ),
  constraint loading_points_ownership_check check (
    ownership = any (array['own'::text, 'partner'::text])
  )
);

comment on table public.loading_points is
  'Точки погрузки: свой БСУ, партнёрский бетон зимой, инерты, цементные заводы.';

create index if not exists loading_points_kind_active_idx
  on public.loading_points (kind, active);

-- Сид: свой БСУ (Орловский тупик) — точка по умолчанию для бетона.
insert into public.loading_points (name, kind, ownership, address, lat, lon, is_default, external_key, notes)
values (
  'БСУ ТрейдКом (Орловский тупик)',
  'concrete',
  'own',
  'Брянск, Орловский тупик, 6',
  53.25347,
  34.416444,
  true,
  'own_bsu_orlovsky',
  'Основная точка погрузки бетона'
)
on conflict (external_key) do update set
  name = excluded.name,
  address = excluded.address,
  lat = excluded.lat,
  lon = excluded.lon,
  is_default = excluded.is_default,
  active = true,
  updated_at = now();

-- Цементные заводы из lib/cementPlants.ts
insert into public.loading_points (name, kind, ownership, address, lat, lon, is_default, external_key, notes)
values
  (
    'Фокино (ЦЕМРОС)',
    'cement',
    'partner',
    '242610, Россия, Брянская обл., г. Фокино, ул. Цементников, д. 1',
    53.44599,
    34.41237,
    false,
    'cement:fokino_cemros',
    'АО «Мальцовский портландцемент»'
  ),
  (
    'Костюковичи (БЦЗ)',
    'cement',
    'partner',
    '213640, Беларусь, Могилёвская обл., г. Костюковичи, ул. Юношеская, 117',
    53.39073,
    32.01319,
    false,
    'cement:kostyukovichi_bcz',
    'ОАО «Белорусский цементный завод»'
  ),
  (
    'Кричев (КЦШ)',
    'cement',
    'partner',
    '213493, Беларусь, Могилёвская обл., Кричевский р-н, Краснобудский с/с, 2',
    53.72933,
    31.72396,
    false,
    'cement:krichev_kcsh',
    'ОАО «Кричевцементношифер»'
  )
on conflict (external_key) do update set
  name = excluded.name,
  address = excluded.address,
  lat = excluded.lat,
  lon = excluded.lon,
  notes = excluded.notes,
  active = true,
  updated_at = now();

-- Фаза 3: тип заявки и техника для отгрузки
alter table public.orders
  add column if not exists order_type text not null default 'concrete';

alter table public.orders
  add column if not exists fleet_vehicle_kind text;

alter table public.orders
  add column if not exists loading_point_id bigint references public.loading_points(id);

alter table public.orders drop constraint if exists orders_order_type_check;
alter table public.orders
  add constraint orders_order_type_check
  check (order_type = any (array['concrete'::text, 'bulk'::text]));

alter table public.orders drop constraint if exists orders_fleet_vehicle_kind_check;
alter table public.orders
  add constraint orders_fleet_vehicle_kind_check
  check (
    fleet_vehicle_kind is null
    or fleet_vehicle_kind = any (array[
      'mixer'::text,
      'dump_truck'::text,
      'tonar'::text,
      'cement_truck'::text,
      'special'::text
    ])
  );

create index if not exists orders_order_type_idx on public.orders (order_type);
create index if not exists orders_loading_point_id_idx on public.orders (loading_point_id);

comment on column public.orders.order_type is 'concrete — бетон; bulk — отгрузка щебня/песка/цемента';
comment on column public.orders.fleet_vehicle_kind is 'Для bulk: dump_truck|tonar|cement_truck. Для concrete обычно mixer/null.';
comment on column public.orders.loading_point_id is 'Точка погрузки (свой БСУ / партнёр / цемент / инерты)';

update public.orders set order_type = 'concrete' where order_type is null or order_type = '';

-- ── RLS: только service_role через /api/adminCifra/loading-points ──
-- anon-ключ из браузера не получает политик → deny by default.
-- API ходит под SUPABASE_SERVICE_ROLE_KEY и RLS игнорирует.
alter table public.loading_points enable row level security;

-- Не больше одной активной точки «по умолчанию» на kind
create unique index if not exists loading_points_one_default_per_kind_uidx
  on public.loading_points (kind)
  where is_default = true and active = true;
