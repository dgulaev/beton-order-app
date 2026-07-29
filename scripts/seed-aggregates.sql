-- Расширение recipes_type_check + сид щебня/песка.
-- В колонке type уже живут и заполнитель бетона (granite/dolomite),
-- и вид продукции (mortar/cps), плюс для инертов: slag/sand.

-- 1) Снимаем старый check
alter table public.recipes drop constraint if exists recipes_type_check;

-- 2) Ставим расширенный check (не трогаем существующие cps/mortar!)
alter table public.recipes
  add constraint recipes_type_check
  check (type is null or type = any (array[
    'granite'::text,
    'dolomite'::text,
    'slag'::text,
    'sand'::text,
    'mortar'::text,
    'cps'::text,
    'lean'::text,
    -- заводы-поставщики цемента (item_type = cement)
    'fokino_cemros'::text,
    'kostyukovichi_bcz'::text,
    'krichev_kcsh'::text
  ]));

-- 3) Вставка позиций прайса (пропускаем уже существующие коды)
insert into public.recipes (code, name, type, price, item_type, unit, is_active, notes)
select v.code, v.name, v.type, v.price, 'aggregate', 'м³', true, v.notes
from (values
  ('ЩГ-5-20',  'Щебень гранитный фр. 5-20',           'granite',  3700, null::text),
  ('ЩГ-20-40', 'Щебень гранитный фр. 20-40',          'granite',  3700, null),
  ('ЩГ-40-70', 'Щебень гранитный фр. 40-70',          'granite',  3700, null),
  ('ЩГ-др',    'Щебень гранитный другие фракции',     'granite',     0, 'по запросу'),
  ('ЩД-5-20',  'Щебень доломитовый фр. 5-20',         'dolomite', 3000, null),
  ('ЩД-20-40', 'Щебень доломитовый фр. 20-40',        'dolomite', 2750, null),
  ('ЩД-40-70', 'Щебень доломитовый фр. 40-70',        'dolomite', 2750, null),
  ('ЩШ-0-20',  'Щебень шлаковый фр. 0-20',            'slag',     2500, null),
  ('ЩШ-20-40', 'Щебень шлаковый фр. 20-40',           'slag',     2500, null),
  ('ЩШ-40-70', 'Щебень шлаковый фр. 40-70',           'slag',     2500, null),
  ('П-намыв',  'Песок намывной (мытый желтый)',       'sand',     1000, null),
  ('П-строит', 'Песок строительный (серый)',          'sand',      800, null),
  ('П-форм',   'Формовочный песок б/у',               'sand',      300, null)
) as v(code, name, type, price, notes)
where not exists (
  select 1 from public.recipes r where r.code = v.code
);
