-- ============================================================
-- Исполнение лида: 1 лид → N заявок, статус fulfilled
--
-- КАК ПРИМЕНИТЬ: Supabase SQL Editor → выполнить целиком.
-- Идемпотентно.
-- ============================================================

-- Разрешить несколько заявок на один лид
drop index if exists public.orders_lead_id_unique;

create index if not exists orders_lead_id_idx on public.orders (lead_id);

-- Статус «Исполнен»
do $$
declare
  conname text;
begin
  for conname in
    select c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'leads'
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%status%'
  loop
    execute format('alter table public.leads drop constraint %I', conname);
  end loop;
end $$;

alter table public.leads
  add constraint leads_status_check
  check (status in ('new', 'in_progress', 'converted', 'fulfilled', 'rejected', 'spam'));

comment on column public.leads.status is
  'new | in_progress | converted (есть заявки/отгрузка) | fulfilled (исполнен) | rejected | spam';

comment on column public.orders.lead_id is
  'Ссылка на лид; один лид может иметь несколько заявок-отгрузок';

select 'leads fulfillment ready' as status;
