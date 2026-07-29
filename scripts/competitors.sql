-- Фаза 6: конкуренты Брянска + снапшоты прайсов.
-- Карточки и координаты также подтягиваются через POST /api/adminCifra/competitors/sync
-- из lib/competitorsCatalog.ts.

create table if not exists public.competitors (
  id bigserial primary key,
  name text not null,
  short_name text,
  website text,
  phone text,
  contact text,
  address text,
  lat double precision,
  lon double precision,
  active boolean not null default true,
  notes text,
  parser_key text,
  sort_order int not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists competitors_name_uidx on public.competitors (lower(name));

create table if not exists public.competitor_price_snapshots (
  id bigserial primary key,
  competitor_id bigint not null references public.competitors(id) on delete cascade,
  grade_key text not null,
  filler text not null default 'granite',
  price numeric(12, 2),
  currency text not null default 'RUB',
  parsed_at timestamptz not null default now(),
  source_url text,
  source_kind text not null default 'manual',
  notes text,
  constraint competitor_price_filler_check check (
    filler = any (array['granite'::text, 'dolomite'::text, 'mortar'::text])
  )
);

create index if not exists competitor_price_snapshots_lookup_idx
  on public.competitor_price_snapshots (competitor_id, grade_key, filler, parsed_at desc);

-- Колонки матрицы (марки) — редактируются в UI
create table if not exists public.competitor_matrix_columns (
  id bigserial primary key,
  grade_key text not null,
  filler text not null,
  label text not null,
  our_code text not null,
  sort_order int not null default 100,
  created_at timestamptz not null default now(),
  constraint competitor_matrix_columns_filler_check check (
    filler = any (array['granite'::text, 'dolomite'::text, 'mortar'::text])
  ),
  constraint competitor_matrix_columns_uniq unique (grade_key, filler)
);

create index if not exists competitor_matrix_columns_sort_idx
  on public.competitor_matrix_columns (sort_order, id);

-- Сид колонок по умолчанию (наши коды)
insert into public.competitor_matrix_columns (grade_key, filler, label, our_code, sort_order)
select v.grade_key, v.filler, v.label, v.our_code, v.sort_order
from (values
  ('М100', 'granite', 'М100', 'М100', 10),
  ('М150', 'granite', 'М150', 'М150', 20),
  ('М200', 'granite', 'М200', 'М200', 30),
  ('М250', 'granite', 'М250', 'М250', 40),
  ('М300', 'granite', 'М300', 'М300', 50),
  ('М350', 'granite', 'М350', 'М350', 60),
  ('М400', 'granite', 'М400', 'М400', 70),
  ('М100', 'dolomite', 'М100и', 'М100и', 110),
  ('М150', 'dolomite', 'М150и', 'М150и', 120),
  ('М200', 'dolomite', 'М200и', 'М200и', 130),
  ('М250', 'dolomite', 'М250и', 'М250и', 140),
  ('М300', 'dolomite', 'М300и', 'М300и', 150),
  ('М100', 'mortar', 'ТР М100', 'ТР М100', 210),
  ('М150', 'mortar', 'ТР М150', 'ТР М150', 220),
  ('М200', 'mortar', 'ТР М200', 'ТР М200', 230)
) as v(grade_key, filler, label, our_code, sort_order)
where not exists (
  select 1 from public.competitor_matrix_columns c
  where c.grade_key = v.grade_key and c.filler = v.filler
);

-- Сид (идемпотентно по имени). Полные данные — через sync API.
insert into public.competitors (name, short_name, notes, sort_order, parser_key)
select v.name, v.short_name, v.notes, v.sort_order, v.parser_key
from (values
  ('УК БЗКПД', 'БЗКПД', 'Прайс вручную', 10, null::text),
  ('Стройсервис', 'Стройсервис', 'Парсер strojservis', 20, 'strojservis'),
  ('ЕКСОН (ЕвроБетон)', 'ЕКСОН', 'Парсер ecson', 30, 'ecson'),
  ('Деловой Бетон', 'Деловой Бетон', 'Прайс вручную', 40, null::text),
  ('МегаБетон (Мегаполис)', 'МегаБетон', 'Парсер megapolis', 50, 'megapolis'),
  ('СпецБетон', 'СпецБетон', 'Парсер specbeton', 60, 'specbeton'),
  ('ПромСтройБетон (Нефтика)', 'ПромСтройБетон', 'Прайс вручную', 70, null::text),
  ('Мастер Бетон', 'Мастер Бетон', 'Парсер masterbeton', 80, 'masterbeton'),
  ('Элит бетон', 'Элит бетон', 'Парсер elitbeton', 90, 'elitbeton'),
  ('СК БЕТОН СТРОЙ', 'СК БЕТОН СТРОЙ', 'В Excel — прайса нет', 100, null::text)
) as v(name, short_name, notes, sort_order, parser_key)
where not exists (
  select 1 from public.competitors c where lower(c.name) = lower(v.name)
);

-- ── RLS: только service_role через /api/adminCifra/competitors* ──
-- anon-ключ из браузера не получает политик → deny by default.
-- API ходит под SUPABASE_SERVICE_ROLE_KEY и RLS игнорирует.
alter table public.competitors enable row level security;
alter table public.competitor_price_snapshots enable row level security;
alter table public.competitor_matrix_columns enable row level security;

-- Один parser_key → один завод (NULL разрешён многократно — ручной ввод)
create unique index if not exists competitors_parser_key_uidx
  on public.competitors (parser_key)
  where parser_key is not null;
