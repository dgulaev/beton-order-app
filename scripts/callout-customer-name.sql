-- Заказчик закупки на карточке «Без победителя» (не путать с победителем в «К обзвону»)
alter table public.callout_tenders
  add column if not exists customer_name text;

comment on column public.callout_tenders.customer_name is
  'Организация-заказчик торгов (из лида / ЕИС). Победитель — в callout_prospects.';
