-- ============================================================
-- Комментарии сотрудников к заявкам
-- Выполнить в Supabase SQL Editor один раз.
-- ============================================================

-- 1) Комментарии
create table if not exists public.order_comments (
  id            bigserial primary key,
  order_id      bigint not null references public.orders(id) on delete cascade,
  user_id       bigint,
  user_name     text not null default 'Сотрудник',
  user_role     text,
  body          text not null,
  created_at    timestamptz not null default now(),
  is_deleted    boolean not null default false
);

create index if not exists order_comments_order_id_idx
  on public.order_comments (order_id, created_at desc);

create index if not exists order_comments_created_at_idx
  on public.order_comments (created_at desc);

-- 2) Прочитано (бейдж пропадает после открытия вкладки «Комментарии»)
create table if not exists public.order_comment_reads (
  comment_id    bigint not null references public.order_comments(id) on delete cascade,
  user_id       bigint not null,
  read_at       timestamptz not null default now(),
  primary key (comment_id, user_id)
);

create index if not exists order_comment_reads_user_id_idx
  on public.order_comment_reads (user_id);

-- 3) Broadcast realtime (тот же паттерн, что у orders / order_mixers)
drop trigger if exists order_comments_broadcast on public.order_comments;
create trigger order_comments_broadcast
  after insert or update or delete on public.order_comments
  for each row execute function public.broadcast_table_change();

-- Топик: order_comments:all

comment on table public.order_comments is
  'Комментарии сотрудников к заявкам (не путать с comment клиента в orders)';
comment on table public.order_comment_reads is
  'Факт прочтения комментария конкретным сотрудником';
