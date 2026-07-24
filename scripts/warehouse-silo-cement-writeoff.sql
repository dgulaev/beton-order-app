-- scripts/warehouse-silo-cement-writeoff.sql
--
-- Три силоса завода (85 / 85 / 170 т), выбор рабочего силоса на смене,
-- атомарное списание цемента при статусе «Разгружен» (как добавки).
-- current может уходить в минус — без пола 0.

-- 1) Ёмкости и имена силосов
-- nominal — номинальная ёмкость (NOT NULL в схеме), держим = max
insert into public.warehouse_silos (silo_id, name, current, max, nominal, updated_at)
values
  (1, 'Силос 1', 0, 85, 85, now()),
  (2, 'Силос 2', 0, 85, 85, now()),
  (3, 'Силос 3', 0, 170, 170, now())
on conflict (silo_id) do update
set
  name = excluded.name,
  max = excluded.max,
  nominal = excluded.nominal,
  updated_at = now();

update public.warehouse_silos set max = 85,  nominal = 85,  name = 'Силос 1', updated_at = now() where silo_id = 1;
update public.warehouse_silos set max = 85,  nominal = 85,  name = 'Силос 2', updated_at = now() where silo_id = 2;
update public.warehouse_silos set max = 170, nominal = 170, name = 'Силос 3', updated_at = now() where silo_id = 3;

-- 2) Рабочий силос на смене оператора
alter table public.operator_shift_settings
  add column if not exists active_silo_id numeric,
  add column if not exists active_silo_set_at timestamptz;

comment on column public.operator_shift_settings.active_silo_id is
  'Силос, с которого списывается цемент при «Загружен»/«В пути» (1/2/3). NULL — не выбран, списание пропускается.';
comment on column public.operator_shift_settings.active_silo_set_at is
  'Когда выбран active_silo_id — для утреннего автосброса (как active_operator_set_at).';

-- 3) Идемпотентность списания цемента на рейсе
alter table public.order_mixers
  add column if not exists cement_write_off_silo_id numeric,
  add column if not exists cement_write_off_kg numeric,
  add column if not exists cement_write_off_at timestamptz;

comment on column public.order_mixers.cement_write_off_silo_id is
  'Силос, с которого списан цемент при «загрузке» рейса (статус В пути / далее).';
comment on column public.order_mixers.cement_write_off_kg is
  'Сколько кг цемента списано со склада за этот рейс (для возврата при откате в Загрузка/удалении).';
comment on column public.order_mixers.cement_write_off_at is
  'Когда списали цемент (момент кнопки «Загружен» / первого пост-загрузочного статуса).';

-- 4) Атомарная корректировка остатка силоса (тонны, со знаком; минус разрешён)
create or replace function public.warehouse_silo_adjust(
  p_silo_id numeric,
  p_delta_tons numeric
)
returns table(old_current numeric, new_current numeric)
language plpgsql
as $$
declare
  v_old numeric;
  v_new numeric;
begin
  select current into v_old
  from public.warehouse_silos
  where silo_id = p_silo_id
  for update;

  if v_old is null then
    raise exception 'Силос % не найден', p_silo_id;
  end if;

  update public.warehouse_silos
  set current = v_old + p_delta_tons,
      updated_at = now()
  where silo_id = p_silo_id
  returning current into v_new;

  old_current := v_old;
  new_current := v_new;
  return next;
end;
$$;

comment on function public.warehouse_silo_adjust(numeric, numeric) is
  'Атомарно меняет warehouse_silos.current на p_delta_tons (т). Отрицательный остаток разрешён. Используется при разгрузке рейса и ручных операциях.';
