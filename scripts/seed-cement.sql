-- Расширение recipes_type_check под заводы-поставщики цемента + сид марок.
-- type для item_type='cement': fokino_cemros | kostyukovichi_bcz | krichev_kcsh
-- Цены в ₽/т. BYN→RUB по курсу ЦБ РФ 27.2538 на 29.07.2026.
-- (координаты заводов — lib/cementPlants.ts)

alter table public.recipes drop constraint if exists recipes_type_check;

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
    'fokino_cemros'::text,
    'kostyukovichi_bcz'::text,
    'krichev_kcsh'::text
  ]));

insert into public.recipes (code, name, type, price, item_type, unit, is_active, notes)
select v.code, v.name, v.type, v.price, 'cement', 'т', true, v.notes
from (values
  ('Ц-ФОК-0-42.5Н',    'ЦЕМ 0 42,5Н',     'fokino_cemros',       0::numeric, 'ГОСТ 31108-2020; бездобавочный; market.cemros.ru — по запросу'),
  ('Ц-ФОК-I-42.5Н',    'ЦЕМ I 42,5Н',     'fokino_cemros',    9276::numeric, 'ГОСТ 31108-2020; market.cemros.ru ≈ 9 275,66 ₽/т с НДС'),
  ('Ц-ФОК-I-42.5Н-ЖИ', 'ЦЕМ I 42,5Н ЖИ',  'fokino_cemros',    8275::numeric, 'ГОСТ Р 55224-2020; market.cemros.ru от 8 275,26 ₽/т'),
  ('Ц-КОС-0-42.5Н',    'ЦЕМ 0 42,5Н',     'kostyukovichi_bcz', 6469::numeric, '237,35 Br/т → 6 469 ₽/т (курс ЦБ РФ 27,2538 на 29.07.2026)'),
  ('Ц-КОС-0-42.5Б',    'ЦЕМ 0 42,5Б',     'kostyukovichi_bcz', 6545::numeric, '240,14 Br/т → 6 545 ₽/т (курс ЦБ РФ 27,2538 на 29.07.2026)'),
  ('Ц-КОС-0-52.5Н',    'ЦЕМ 0 52,5Н',     'kostyukovichi_bcz', 6545::numeric, '240,14 Br/т → 6 545 ₽/т (курс ЦБ РФ 27,2538 на 29.07.2026)'),
  ('Ц-КОС-I-42.5Н',    'ЦЕМ I 42,5Н',     'kostyukovichi_bcz', 6489::numeric, '238,10 Br/т → 6 489 ₽/т (курс ЦБ РФ 27,2538 на 29.07.2026)'),
  ('Ц-КОС-I-42.5Б',    'ЦЕМ I 42,5Б',     'kostyukovichi_bcz', 6588::numeric, '241,73 Br/т → 6 588 ₽/т (курс ЦБ РФ 27,2538 на 29.07.2026)'),
  ('Ц-КОС-I-52.5Н',    'ЦЕМ I 52,5Н',     'kostyukovichi_bcz',    0::numeric, 'цена уточняется у завода'),
  ('Ц-КРИ-0-42.5Н',    'ЦЕМ 0 42,5Н',     'krichev_kcsh',     6627::numeric, '243,17 Br/т → 6 627 ₽/т (курс ЦБ РФ 27,2538 на 29.07.2026)'),
  ('Ц-КРИ-0-42.5Б',    'ЦЕМ 0 42,5Б',     'krichev_kcsh',     6627::numeric, '243,17 Br/т → 6 627 ₽/т (курс ЦБ РФ 27,2538 на 29.07.2026)'),
  ('Ц-КРИ-0-52.5Н',    'ЦЕМ 0 52,5Н',     'krichev_kcsh',     6733::numeric, '247,03 Br/т → 6 733 ₽/т (курс ЦБ РФ 27,2538 на 29.07.2026)'),
  ('Ц-КРИ-0-52.5Б',    'ЦЕМ 0 52,5Б',     'krichev_kcsh',     6733::numeric, '247,03 Br/т → 6 733 ₽/т (курс ЦБ РФ 27,2538 на 29.07.2026)'),
  ('Ц-КРИ-I-42.5Н',    'ЦЕМ I 42,5Н',     'krichev_kcsh',     6463::numeric, '237,14 Br/т → 6 463 ₽/т (курс ЦБ РФ 27,2538 на 29.07.2026)'),
  ('Ц-КРИ-I-42.5Б',    'ЦЕМ I 42,5Б',     'krichev_kcsh',     6606::numeric, '242,39 Br/т → 6 606 ₽/т (курс ЦБ РФ 27,2538 на 29.07.2026)'),
  ('Ц-КРИ-I-52.5Н',    'ЦЕМ I 52,5Н',     'krichev_kcsh',     6711::numeric, '246,25 Br/т → 6 711 ₽/т (курс ЦБ РФ 27,2538 на 29.07.2026)'),
  ('Ц-КРИ-I-52.5Б',    'ЦЕМ I 52,5Б',     'krichev_kcsh',     6711::numeric, '246,25 Br/т → 6 711 ₽/т (курс ЦБ РФ 27,2538 на 29.07.2026)')
) as v(code, name, type, price, notes)
where not exists (
  select 1 from public.recipes r where r.code = v.code
);

-- Если марки уже залиты со старыми ценами в Br — пересчитать в ₽
update public.recipes
set price = round(price * 27.2538),
    notes = coalesce(notes || '; ', '') || 'пересчитано в ₽ по курсу ЦБ РФ 27,2538 на 29.07.2026'
where item_type = 'cement'
  and type in ('kostyukovichi_bcz', 'krichev_kcsh')
  and price > 0
  and price < 2000;
