-- ============================================================
-- Фаза 1 FMS: история GPS-точек (локальный trail)
-- КАК ПРИМЕНИТЬ: Supabase SQL Editor → выполнить целиком.
-- ============================================================

create table if not exists public.fleet_telemetry_points (
  id             bigserial primary key,
  mixer_id       bigint not null references public.mixers(id) on delete cascade,
  scout_unit_id  int,
  lat            numeric not null,
  lon            numeric not null,
  speed_kmh      numeric,
  recorded_at    timestamptz not null,
  source         text not null default 'scout_sync',
  created_at     timestamptz not null default now()
);

create index if not exists fleet_telemetry_points_mixer_time_idx
  on public.fleet_telemetry_points (mixer_id, recorded_at desc);

comment on table public.fleet_telemetry_points is
  'История GPS (тонкий trail из scout-sync). Retention ~90 дней.';

alter table public.fleet_telemetry_points enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'fleet_telemetry_points'
      and policyname = 'fleet_telemetry_points_deny_all'
  ) then
    create policy fleet_telemetry_points_deny_all on public.fleet_telemetry_points
      for all to anon, authenticated
      using (false)
      with check (false);
  end if;
end $$;

select 'fleet-telemetry-points ready' as status;

notify pgrst, 'reload schema';
