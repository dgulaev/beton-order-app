-- ============================================================
-- Головы (tractor_unit) + сцепки голова↔прицеп (бочка / тоннар).
-- Идемпотентен.
--
-- КАК ПРИМЕНИТЬ:
--   Supabase Dashboard → SQL Editor → выполнить скрипт целиком.
-- ============================================================

-- 1) Вид техники: голова-тягач
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
  'Вид: mixer|dump_truck|tonar|cement_truck|special|tractor_unit (голова).';

-- 2) Сцепки
create table if not exists public.fleet_couples (
  id            bigserial primary key,
  tractor_id    bigint not null references public.mixers(id) on delete cascade,
  trailer_id    bigint not null references public.mixers(id) on delete cascade,
  active        boolean not null default true,
  coupled_at    timestamptz not null default now(),
  uncoupled_at  timestamptz null,
  coupled_by    text null,
  created_at    timestamptz not null default now()
);

comment on table public.fleet_couples is
  'Сцепка голова (tractor_unit) + прицеп (cement_truck|tonar). active=true — текущая.';

create unique index if not exists fleet_couples_active_tractor_uidx
  on public.fleet_couples (tractor_id) where active;

create unique index if not exists fleet_couples_active_trailer_uidx
  on public.fleet_couples (trailer_id) where active;

create index if not exists fleet_couples_active_idx
  on public.fleet_couples (active) where active;

alter table public.fleet_couples enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'fleet_couples' and policyname = 'fleet_couples_deny_all'
  ) then
    create policy fleet_couples_deny_all on public.fleet_couples
      for all to anon, authenticated
      using (false)
      with check (false);
  end if;
end $$;

-- 3) Снимок сцепки на рейсе (история не ломается при перецепке)
alter table public.order_mixers
  add column if not exists couple_id bigint null references public.fleet_couples(id) on delete set null;

alter table public.order_mixers
  add column if not exists tractor_id bigint null references public.mixers(id) on delete set null;

alter table public.order_mixers
  add column if not exists trailer_id bigint null references public.mixers(id) on delete set null;

comment on column public.order_mixers.couple_id is 'Сцепка на момент назначения рейса (снимок)';
comment on column public.order_mixers.tractor_id is 'Голова на момент назначения';
comment on column public.order_mixers.trailer_id is 'Прицеп на момент назначения';
