-- Шаблоны объявлений Авито (редактируются из админки «Площадки»)
-- Выполнить в Supabase SQL Editor один раз.

create table if not exists public.marketplace_listing_templates (
  key           text primary key,
  title         text not null,
  description   text not null,
  price         numeric not null check (price >= 0),
  grade         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.marketplace_listing_templates is
  'Переопределения шаблонов объявлений Авито; если ключа нет — используется дефолт из кода';

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  NEW.updated_at := now();
  return NEW;
end;
$$;

drop trigger if exists marketplace_listing_templates_set_updated_at
  on public.marketplace_listing_templates;
create trigger marketplace_listing_templates_set_updated_at
  before update on public.marketplace_listing_templates
  for each row execute function public.set_updated_at();

alter table public.marketplace_listing_templates enable row level security;
