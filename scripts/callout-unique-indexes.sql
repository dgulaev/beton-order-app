-- ============================================================
-- Уникальность ключей обзвона (идемпотентно)
--
-- СНАЧАЛА: scripts/callout-dedupe.sql (почистить дубли)
-- ПОТОМ:   этот скрипт
--
-- Если CREATE INDEX упадёт с «duplicate key» — снова прогони dedupe.
-- ============================================================

-- Один observation на лид (если lead_id задан)
create unique index if not exists callout_tenders_lead_id_uidx
  on public.callout_tenders (lead_id)
  where lead_id is not null;

-- Один observation на номер закупки
create unique index if not exists callout_tenders_purchase_number_uidx
  on public.callout_tenders (purchase_number)
  where purchase_number is not null and length(purchase_number) >= 11;

-- Один observation на реестровый номер контракта
create unique index if not exists callout_tenders_contract_reg_num_uidx
  on public.callout_tenders (contract_reg_num)
  where contract_reg_num is not null and length(contract_reg_num) >= 11;

select 'callout unique indexes ready' as status;
