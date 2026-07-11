-- ============================================================
-- 1) СРОЧНО: закрыть публичный доступ к users (password_hash!)
--    Проверено эмпирически: anon-ключ сейчас читает ВСЮ таблицу users,
--    включая password_hash, у всех 111 сотрудников/клиентов.
--    Клиентский код НИГДЕ не делает supabase.from('users') напрямую —
--    все запросы идут через серверные API (service_role), так что
--    это безопасно закрыть полностью для anon/authenticated.
-- ============================================================
alter table public.users enable row level security;

drop policy if exists "users_no_anon_access" on public.users;
create policy "users_no_anon_access"
  on public.users
  for select
  to anon, authenticated
  using (false);

-- service_role продолжит работать как обычно (RLS на него не действует).


-- ============================================================
-- 2) REPLICA IDENTITY FULL для orders и order_mixers
--    Без этого payload.old при UPDATE содержит только id,
--    и хук useOrderChangeNotifications (app/adminCifra/layout.tsx)
--    не сможет корректно сравнивать oldRecord.status/volume/... —
--    будет либо всегда true, либо всегда false (ложные/пропущенные уведомления).
-- ============================================================
alter table public.orders REPLICA IDENTITY FULL;
alter table public.order_mixers REPLICA IDENTITY FULL;


-- ============================================================
-- 3) Убедиться, что orders, order_mixers и production_logs входят
--    в публикацию realtime (обычно включается через Studio →
--    Database → Replication, но можно и через SQL — команда
--    идемпотентна благодаря проверке).
-- ============================================================
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'orders'
  ) then
    alter publication supabase_realtime add table public.orders;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'order_mixers'
  ) then
    alter publication supabase_realtime add table public.order_mixers;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'production_logs'
  ) then
    alter publication supabase_realtime add table public.production_logs;
  end if;
end $$;


-- ============================================================
-- 3.1) Открыть anon SELECT на production_logs — используется
--      только для realtime-ленты "Отгружено сегодня" оператора БСУ.
--      Сейчас anon получает 0 строк (RLS включён без политики) —
--      без этой политики realtime-подписка не доставит ни одной вставки.
--      Данные не персональные (объём/марка/время отгрузки), риска нет.
-- ============================================================
alter table public.production_logs enable row level security;

drop policy if exists "production_logs_anon_select" on public.production_logs;
create policy "production_logs_anon_select"
  on public.production_logs
  for select
  to anon, authenticated
  using (true);


-- ============================================================
-- 4) Проверочные запросы — что сейчас реально включено
-- ============================================================
-- Список таблиц в публикации realtime:
select schemaname, tablename from pg_publication_tables where pubname = 'supabase_realtime';

-- REPLICA IDENTITY по таблицам (f = full, d = default/PK, n = nothing, i = index):
select relname, case relreplident
  when 'f' then 'FULL' when 'd' then 'DEFAULT (PK only)'
  when 'n' then 'NOTHING' when 'i' then 'INDEX' end as replica_identity
from pg_class
where relname in ('orders', 'order_mixers', 'production_logs', 'users');

-- Все текущие политики RLS в public-схеме:
select schemaname, tablename, policyname, roles, cmd, qual
from pg_policies
where schemaname = 'public'
order by tablename;
