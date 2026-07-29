-- ============================================================
-- Системные настройки adminCifra — одна строка (id=1), JSON в data.
-- Редактируется на /adminCifra/settings (только admin).
--
-- КАК ПРИМЕНИТЬ:
--   Supabase Dashboard → SQL Editor → выполнить скрипт целиком.
-- Идемпотентен.
-- ============================================================

create table if not exists public.system_settings (
  id          bigint primary key default 1,
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  constraint system_settings_singleton check (id = 1)
);

insert into public.system_settings (id, data)
values (1, '{}'::jsonb)
on conflict (id) do nothing;

comment on table public.system_settings is
  'Глобальные настройки ЦИФРА: уведомления, завод/гео, нормы, склад, интерфейс, права меню';

-- Доступ только через service_role (API Next.js). anon/authenticated — без политик.
alter table public.system_settings enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'system_settings' and policyname = 'system_settings_deny_all'
  ) then
    -- Явный deny не обязателен при RLS без policies, но фиксируем намерение.
    create policy system_settings_deny_all on public.system_settings
      for all to anon, authenticated
      using (false)
      with check (false);
  end if;
end $$;
