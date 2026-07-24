-- Рецепты «полы бд» — заливка полов под топинг без добавки.
-- Состав как у обычных М300 / М350, additive = 0.
-- Идемпотентно: можно запускать повторно.

insert into public.recipes (
  code, name, price, type,
  cement, sand, gravel, water,
  additive, additive2, is_active, item_type, unit,
  strength_class, frost_resistance, water_resistance, slump
)
select
  'М300 полы бд',
  'Бетон М300 полы бд (без добавки, под топинг)',
  r.price, r.type,
  r.cement, r.sand, r.gravel, r.water,
  0, 0, r.is_active, r.item_type, r.unit,
  r.strength_class, r.frost_resistance, r.water_resistance, r.slump
from public.recipes r
where trim(r.code) = 'М300'
  and not exists (
    select 1 from public.recipes x where trim(x.code) = 'М300 полы бд'
  );

insert into public.recipes (
  code, name, price, type,
  cement, sand, gravel, water,
  additive, additive2, is_active, item_type, unit,
  strength_class, frost_resistance, water_resistance, slump
)
select
  'М350 полы бд',
  'Бетон М350 полы бд (без добавки, под топинг)',
  r.price, r.type,
  r.cement, r.sand, r.gravel, r.water,
  0, 0, r.is_active, r.item_type, r.unit,
  r.strength_class, r.frost_resistance, r.water_resistance, r.slump
from public.recipes r
where trim(r.code) = 'М350'
  and not exists (
    select 1 from public.recipes x where trim(x.code) = 'М350 полы бд'
  );

-- проверка
select code, name, cement, sand, gravel, water, additive, additive2
from public.recipes
where trim(code) in ('М300', 'М300 полы бд', 'М350', 'М350 полы бд')
order by code;
