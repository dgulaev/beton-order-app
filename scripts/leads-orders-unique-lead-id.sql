-- Один лид → максимум один заказ (защита от гонки двойной конверсии).
-- Применить в Supabase SQL Editor один раз.

create unique index if not exists orders_lead_id_unique
  on public.orders (lead_id)
  where lead_id is not null;

comment on index public.orders_lead_id_unique is
  'Запрещает два заказа с одним lead_id';
