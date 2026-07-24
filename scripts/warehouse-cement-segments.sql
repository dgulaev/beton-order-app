-- scripts/warehouse-cement-segments.sql
--
-- Сегменты списания цемента внутри одного рейса (order_mixers).
-- Нужны, когда оператор меняет рабочий силос посреди загрузки:
-- mid_load — кусок, списанный в момент переключения;
-- final — остаток при «В пути» / первом пост-загрузочном статусе.
--
-- Поля order_mixers.cement_write_off_* остаются агрегатом (сумма кг / последний силос)
-- для совместимости с UI и старыми рейсами без сегментов.

create table if not exists public.order_mixer_cement_segments (
  id bigserial primary key,
  order_mixer_id bigint not null references public.order_mixers(id) on delete cascade,
  silo_id numeric not null check (silo_id in (1, 2, 3)),
  volume_m3 numeric not null check (volume_m3 > 0),
  cement_kg numeric not null check (cement_kg > 0),
  kind text not null check (kind in ('mid_load', 'final')),
  created_at timestamptz not null default now()
);

create index if not exists order_mixer_cement_segments_mixer_idx
  on public.order_mixer_cement_segments (order_mixer_id);

create index if not exists order_mixer_cement_segments_silo_idx
  on public.order_mixer_cement_segments (silo_id, created_at desc);

comment on table public.order_mixer_cement_segments is
  'Сегменты списания цемента по силосам внутри одного рейса (смена силоса mid-load + final).';
comment on column public.order_mixer_cement_segments.kind is
  'mid_load — при переключении силоса во время загрузки; final — остаток при «В пути».';
comment on column public.order_mixer_cement_segments.volume_m3 is
  'Объём бетона (м³), отнесённый к этому силосу.';
comment on column public.order_mixer_cement_segments.cement_kg is
  'Списано цемента (кг) = volume_m3 × дозировка рецепта.';

-- Не больше одного final на рейс
create unique index if not exists order_mixer_cement_segments_one_final_idx
  on public.order_mixer_cement_segments (order_mixer_id)
  where kind = 'final';
