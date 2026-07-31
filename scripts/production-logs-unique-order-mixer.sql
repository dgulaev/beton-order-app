-- ============================================================
-- production_logs: один лог на один рейс (order_mixer_id).
--
-- КАК ПРИМЕНИТЬ:
--   Supabase Dashboard → SQL Editor → выполнить целиком.
--
-- Сначала чистит дубли (оставляет запись с максимальным id),
-- затем ставит уникальный индекс.
-- ============================================================

-- 1) Удалить дубли: оставить одну строку на order_mixer_id (последнюю по id)
with ranked as (
  select
    id,
    order_mixer_id,
    row_number() over (
      partition by order_mixer_id
      order by id desc
    ) as rn
  from public.production_logs
  where order_mixer_id is not null
)
delete from public.production_logs pl
using ranked r
where pl.id = r.id
  and r.rn > 1;

-- 2) Уникальность: один лог на рейс
create unique index if not exists production_logs_order_mixer_id_uidx
  on public.production_logs (order_mixer_id)
  where order_mixer_id is not null;

comment on index public.production_logs_order_mixer_id_uidx is
  'Один production_log на order_mixer_id — защита от повторного «Загружен»';
