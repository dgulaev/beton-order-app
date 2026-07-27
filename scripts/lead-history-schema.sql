-- ============================================================
-- История изменений лидов (кто создал / взял / сменил статус)
--
-- КАК ПРИМЕНИТЬ:
--   1. Supabase Dashboard → SQL Editor
--   2. Вставьте и выполните весь скрипт
--
-- Скрипт идемпотентен.
-- ============================================================

create table if not exists public.lead_history (
  id          bigserial primary key,
  lead_id     bigint not null references public.leads(id) on delete cascade,
  action      text not null,
  user_id     bigint,
  user_name   text,
  user_role   text,
  field_name  text,
  old_value   text,
  new_value   text,
  created_at  timestamptz not null default now()
);

create index if not exists lead_history_lead_id_created_idx
  on public.lead_history (lead_id, created_at desc, id desc);

create index if not exists lead_history_created_idx
  on public.lead_history (created_at desc, id desc);

comment on table public.lead_history is 'Аудит действий по лидам: создание, взятие в работу, смена статуса';

select 'lead_history ready' as status, count(*)::int as rows_now
from public.lead_history;
