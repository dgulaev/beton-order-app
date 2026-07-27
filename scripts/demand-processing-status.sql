-- ============================================================
-- Статус demand_items: processing («Обработка»)
-- Промежуточный этап до отправки в лиды (торги / документы).
--
-- КАК ПРИМЕНИТЬ: Supabase SQL Editor → выполнить целиком.
-- ============================================================

do $$
declare
  conname text;
begin
  select c.conname into conname
  from pg_constraint c
  join pg_class t on c.conrelid = t.oid
  join pg_namespace n on n.oid = t.relnamespace
  where n.nspname = 'public'
    and t.relname = 'demand_items'
    and c.contype = 'c'
    and pg_get_constraintdef(c.oid) ilike '%status%';

  if conname is not null then
    execute format('alter table public.demand_items drop constraint %I', conname);
  end if;
end $$;

alter table public.demand_items
  add constraint demand_items_status_check
  check (status in ('new', 'relevant', 'ignored', 'taken', 'processing'));

comment on column public.demand_items.status is
  'new | relevant | processing | taken | ignored — processing = в работе у специалиста по торгам';

select 'demand processing status ready' as status;
