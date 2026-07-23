-- Плотность добавок (кг/л) в настройках лаборатории.
-- Используется: поступление на склад (т → л) и автосписание при разгрузке (кг → л).
-- Fallback в коде: ПФМ 1.16, Линомикс 1.18 (lib/recipeAdditives.ts).

alter table public.lab_settings
  add column if not exists pfm_density_kg_per_l numeric(6, 3),
  add column if not exists linomix_density_kg_per_l numeric(6, 3);

comment on column public.lab_settings.pfm_density_kg_per_l is
  'Плотность ПФМ-НЛК, кг на 1 литр. Для перевода тонн→литры на складе и кг→литры при списании.';
comment on column public.lab_settings.linomix_density_kg_per_l is
  'Плотность Линомикс ТипР, кг на 1 литр.';

update public.lab_settings
set
  pfm_density_kg_per_l = coalesce(pfm_density_kg_per_l, 1.16),
  linomix_density_kg_per_l = coalesce(linomix_density_kg_per_l, 1.18),
  updated_at = now()
where id = 1;
