-- Метка выбора рабочего силоса — утренний автосброс (как смена оператора).
alter table public.operator_shift_settings
  add column if not exists active_silo_set_at timestamptz;

comment on column public.operator_shift_settings.active_silo_set_at is
  'Когда выбран active_silo_id — для утреннего автосброса на странице оператора.';
