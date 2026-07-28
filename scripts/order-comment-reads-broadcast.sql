-- Live-обновление «кто прочитал» в ленте комментариев.
-- Выполнить один раз в Supabase SQL Editor (если основной schema уже был применён без этого триггера).

drop trigger if exists order_comment_reads_broadcast on public.order_comment_reads;
create trigger order_comment_reads_broadcast
  after insert or update or delete on public.order_comment_reads
  for each row execute function public.broadcast_table_change();

-- Топик: order_comment_reads:all
