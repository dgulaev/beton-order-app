-- Фаза 1 «Техника»: вид техники + JSON-спеки на таблице mixers.
-- Существующие строки → vehicle_kind = 'mixer'. type по-прежнему own|rented.

alter table public.mixers
  add column if not exists vehicle_kind text not null default 'mixer';

alter table public.mixers
  add column if not exists specs jsonb not null default '{}'::jsonb;

alter table public.mixers drop constraint if exists mixers_vehicle_kind_check;
alter table public.mixers
  add constraint mixers_vehicle_kind_check
  check (vehicle_kind = any (array[
    'mixer'::text,
    'dump_truck'::text,
    'tonar'::text,
    'cement_truck'::text,
    'special'::text,
    'tractor_unit'::text
  ]));

comment on column public.mixers.vehicle_kind is
  'Вид техники: mixer|dump_truck|tonar|cement_truck|special|tractor_unit. Для бетонных рейсов — только mixer.';

comment on column public.mixers.specs is
  'Параметры по виду техники (грузоподъёмность, ковш, вылет стрелы и т.п.).';

create index if not exists mixers_vehicle_kind_idx on public.mixers (vehicle_kind);

update public.mixers set vehicle_kind = 'mixer' where vehicle_kind is null or vehicle_kind = '';
