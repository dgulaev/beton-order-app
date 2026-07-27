-- Право обрабатывать торги / спрос (вместо хака по ФИО «туманова»).
-- Применить в Supabase SQL Editor.

alter table public.users
  add column if not exists can_process_tenders boolean not null default false;

comment on column public.users.can_process_tenders is
  'Сотрудник может обрабатывать торги/спрос: назначение исполнителей, документы, отправка в работу. Админы имеют доступ независимо от флага.';

-- Одноразовый seed: текущий специалист по торгам (Екатерина Туманова).
update public.users
set can_process_tenders = true
where full_name ilike '%туманова%';
