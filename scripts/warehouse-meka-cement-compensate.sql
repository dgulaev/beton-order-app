-- scripts/warehouse-meka-cement-compensate.sql
--
-- Идемпотентная компенсация разницы MEKA − склад по силосам
-- (один раз на календарный день МСК после загрузки отчёта MEKA).
--
-- Также расширяет warehouse_cement_savings.reason значением meka_reconcile
-- (когда завод сжёг меньше, чем списано по рецептам — возврат + экономия).

-- 1) Факт компенсации за день
create table if not exists public.warehouse_meka_cement_compensations (
  id bigserial primary key,
  report_date date not null,
  meka_report_id bigint,
  meka_kg numeric not null,
  warehouse_kg numeric not null,
  delta_kg numeric not null,
  status text not null check (
    status in ('applied', 'skipped_noise', 'skipped_no_warehouse')
  ),
  by_silo jsonb not null default '[]'::jsonb,
  user_name text,
  created_at timestamptz not null default now(),
  constraint warehouse_meka_cement_compensations_date_uidx unique (report_date)
);

create index if not exists warehouse_meka_cement_compensations_created_idx
  on public.warehouse_meka_cement_compensations (created_at desc);

comment on table public.warehouse_meka_cement_compensations is
  'Компенсация MEKA−склад по силосам: один факт на report_date.';
comment on column public.warehouse_meka_cement_compensations.delta_kg is
  'MEKA − склад (кг). >0 досписание, <0 возврат.';
comment on column public.warehouse_meka_cement_compensations.by_silo is
  '[{siloId, kg, direction: "writeoff"|"return"}] — кг всегда > 0.';
comment on column public.warehouse_meka_cement_compensations.status is
  'applied — применено; skipped_noise — |delta|<порога; skipped_no_warehouse — не было списаний рейсов.';

-- 2) Экономия: новый reason
alter table public.warehouse_cement_savings
  drop constraint if exists warehouse_cement_savings_reason_check;

alter table public.warehouse_cement_savings
  add constraint warehouse_cement_savings_reason_check
  check (reason in ('reset', 'refill', 'meka_reconcile'));

comment on column public.warehouse_cement_savings.reason is
  'reset — обнуление; refill — внесение при минусе; meka_reconcile — возврат по сверке MEKA.';
