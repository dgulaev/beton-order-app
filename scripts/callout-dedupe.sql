-- ============================================================
-- Очистка дублей callout_tenders перед уникальными индексами
--
-- КАК ПРИМЕНИТЬ (Supabase → SQL Editor):
--   1. Блок A — посмотреть, сколько дублей (безопасно, только SELECT)
--   2. Блок B — удалить дубли (оставить «лучшую» строку)
--   3. Блок C — сироты-карточки без тендеров
--   4. Потом выполнить scripts/callout-unique-indexes.sql
--
-- «Лучшая» строка: есть prospect_id → found → свежий updated_at → меньший id
-- ============================================================

-- ---------- A. Превью дублей (можно гонять сколько угодно) ----------

-- Дубли по lead_id
select 'lead_id' as kind, lead_id::text as key, count(*) as cnt, array_agg(id order by id) as ids
from public.callout_tenders
where lead_id is not null
group by lead_id
having count(*) > 1
order by cnt desc;

-- Дубли по номеру закупки
select 'purchase_number' as kind, purchase_number as key, count(*) as cnt, array_agg(id order by id) as ids
from public.callout_tenders
where purchase_number is not null and length(purchase_number) >= 11
group by purchase_number
having count(*) > 1
order by cnt desc;

-- Дубли по реестру контракта
select 'contract_reg_num' as kind, contract_reg_num as key, count(*) as cnt, array_agg(id order by id) as ids
from public.callout_tenders
where contract_reg_num is not null and length(contract_reg_num) >= 11
group by contract_reg_num
having count(*) > 1
order by cnt desc;

-- ---------- B. Удаление дублей ----------
-- Перед запуском убедись, что превью выше тебя устраивает.

begin;

-- 1) lead_id: один лид → одна запись
with ranked as (
  select
    id,
    row_number() over (
      partition by lead_id
      order by
        (prospect_id is not null) desc,
        case winner_status
          when 'found' then 1
          when 'pending' then 2
          when 'manual' then 3
          when 'missing' then 4
          when 'failed' then 5
          else 6
        end,
        updated_at desc nulls last,
        id asc
    ) as rn
  from public.callout_tenders
  where lead_id is not null
),
losers as (
  select id from ranked where rn > 1
)
delete from public.callout_tenders t
using losers l
where t.id = l.id;

-- 2) purchase_number
with ranked as (
  select
    id,
    row_number() over (
      partition by purchase_number
      order by
        (prospect_id is not null) desc,
        (lead_id is not null) desc,
        case winner_status
          when 'found' then 1
          when 'pending' then 2
          when 'manual' then 3
          when 'missing' then 4
          when 'failed' then 5
          else 6
        end,
        updated_at desc nulls last,
        id asc
    ) as rn
  from public.callout_tenders
  where purchase_number is not null and length(purchase_number) >= 11
),
losers as (
  select id from ranked where rn > 1
)
delete from public.callout_tenders t
using losers l
where t.id = l.id;

-- 3) contract_reg_num
with ranked as (
  select
    id,
    row_number() over (
      partition by contract_reg_num
      order by
        (prospect_id is not null) desc,
        (lead_id is not null) desc,
        case winner_status
          when 'found' then 1
          when 'pending' then 2
          when 'manual' then 3
          when 'missing' then 4
          when 'failed' then 5
          else 6
        end,
        updated_at desc nulls last,
        id asc
    ) as rn
  from public.callout_tenders
  where contract_reg_num is not null and length(contract_reg_num) >= 11
),
losers as (
  select id from ranked where rn > 1
)
delete from public.callout_tenders t
using losers l
where t.id = l.id;

commit;

-- ---------- C. Карточки без единой закупки (после чистки тендеров) ----------
-- Комментарии удалятся cascade. Запусти отдельно, если нужно.

-- Превью сирот:
select p.id, p.organization_name, p.inn, p.phone, p.status
from public.callout_prospects p
where not exists (
  select 1 from public.callout_tenders t where t.prospect_id = p.id
)
order by p.id;

-- Удалить сирот (раскомментируй, если превью ок):
-- delete from public.callout_prospects p
-- where not exists (
--   select 1 from public.callout_tenders t where t.prospect_id = p.id
-- );

-- ---------- Проверка: дублей больше быть не должно ----------
select 'lead_id leftovers' as check, count(*) as groups
from (
  select lead_id from public.callout_tenders
  where lead_id is not null
  group by lead_id having count(*) > 1
) x
union all
select 'purchase_number leftovers', count(*)
from (
  select purchase_number from public.callout_tenders
  where purchase_number is not null and length(purchase_number) >= 11
  group by purchase_number having count(*) > 1
) x
union all
select 'contract_reg_num leftovers', count(*)
from (
  select contract_reg_num from public.callout_tenders
  where contract_reg_num is not null and length(contract_reg_num) >= 11
  group by contract_reg_num having count(*) > 1
) x;

select 'callout dedupe done — дальше callout-unique-indexes.sql' as status;
