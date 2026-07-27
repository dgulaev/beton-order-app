-- Пометка клиентов-спама (публичка → лид → Спам).
-- Скрываются из списка клиентов по умолчанию.
-- Применить в Supabase SQL Editor.

alter table public.users
  add column if not exists is_spam boolean not null default false;

create index if not exists users_client_is_spam_idx
  on public.users (is_spam)
  where role = 'client';

comment on column public.users.is_spam is
  'Клиент помечен как спам (из лида). Не показывать в CRM по умолчанию.';
