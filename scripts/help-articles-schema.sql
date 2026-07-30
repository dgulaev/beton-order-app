-- ============================================================
-- Инструкции (справка) — оверлеи поверх дефолтов из кода (lib/help/articles).
-- Редактируется на /adminCifra/settings → вкладка «Инструкции» (только admin).
--
-- КАК ПРИМЕНИТЬ:
--   Supabase Dashboard → SQL Editor → выполнить скрипт целиком.
-- Идемпотентен.
-- ============================================================

create table if not exists public.help_articles (
  id          text primary key,
  title       text not null,
  summary     text not null default '',
  roles       jsonb not null default '[]'::jsonb,
  route       text,
  routes      jsonb,
  body        jsonb not null default '[]'::jsonb,
  updated_at  timestamptz not null default now(),
  updated_by  bigint
);

comment on table public.help_articles is
  'Оверлеи текстов справки adminCifra/mobile. id совпадает с дефолтом в коде; нет строки = дефолт.';

alter table public.help_articles enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'help_articles' and policyname = 'help_articles_deny_all'
  ) then
    create policy help_articles_deny_all on public.help_articles
      for all to anon, authenticated
      using (false)
      with check (false);
  end if;
end $$;

-- Чтобы PostgREST сразу увидел новую таблицу (иначе: schema cache / Could not find the table).
notify pgrst, 'reload schema';
