// Классификация позиций каталога «Продукция» (бывш. Рецептуры).
// item_type в recipes:
//   null / concrete / '' → бетон, раствор, тощий бетон, ЦПС
//   'aggregate'          → щебень и песок
//   'cement'             → цемент (поставщики / точки погрузки)
//   'fbs'                → ЖБИ (блоки ФБС)
//
// Для цемента поле type = id завода (см. lib/cementPlants.ts).

import {
  BYN_TO_RUB_RATE,
  BYN_TO_RUB_RATE_AS_OF,
  CEMENT_SUPPLIER_PLANTS,
  bynToRub,
  cementPriceRub,
  type CementPlantId,
  getCementPlant,
} from '@/lib/cementPlants';

export type ProductSection = 'concrete' | 'aggregate' | 'cement' | 'jbi';

export type AggregateKind = 'granite' | 'dolomite' | 'slag' | 'sand';

export type ConcreteKind = 'concrete' | 'mortar' | 'lean' | 'cps';

export type { CementPlantId };

export const PRODUCT_SECTIONS: { key: ProductSection; label: string; hint: string }[] = [
  { key: 'concrete', label: 'Бетон и растворы', hint: 'Бетон, раствор, тощий бетон, пескоцементная смесь' },
  { key: 'aggregate', label: 'Щебень и песок', hint: 'Инертные материалы самовывозом' },
  { key: 'cement', label: 'Цемент', hint: 'Марки с заводов-поставщиков (Фокино, Костюковичи, Кричев)' },
  { key: 'jbi', label: 'ЖБИ', hint: 'Блоки ФБС и другие ЖБИ' },
];

export const AGGREGATE_KINDS: { key: AggregateKind; label: string }[] = [
  { key: 'granite', label: 'Щебень гранитный' },
  { key: 'dolomite', label: 'Щебень доломитовый' },
  { key: 'slag', label: 'Щебень шлаковый' },
  { key: 'sand', label: 'Песок' },
];

export const CONCRETE_KINDS: { key: ConcreteKind; label: string }[] = [
  { key: 'concrete', label: 'Бетон' },
  { key: 'mortar', label: 'Раствор' },
  { key: 'lean', label: 'Тощий бетон' },
  { key: 'cps', label: 'Пескоцементная смесь' },
];

/** Фильтр / группировка цемента по заводу (type в recipes). */
export const CEMENT_PLANT_FILTERS: { key: CementPlantId; label: string }[] =
  CEMENT_SUPPLIER_PLANTS.map((p) => ({ key: p.id, label: p.shortName }));

export function isFbs(r: {
  item_type?: string | null;
  code?: string | null;
  name?: string | null;
}): boolean {
  if (r?.item_type === 'fbs') return true;
  const code = String(r?.code || '');
  if (code.startsWith('24-')) return true;
  // Коды вида 30-3-6 (нестандартная длина) + название с «ФБС»
  if (/фбс/i.test(code) || /фбс/i.test(String(r?.name || ''))) return true;
  return false;
}

export function isAggregate(r: { item_type?: string | null }): boolean {
  return r?.item_type === 'aggregate';
}

export function isCement(r: { item_type?: string | null }): boolean {
  return r?.item_type === 'cement';
}

/** Бетон / раствор / тощий / ЦПС — для заказов, списаний, спецификаций. */
export function isOrderGradeRecipe(r: { item_type?: string | null; code?: string | null }): boolean {
  return !isAggregate(r) && !isCement(r) && !isFbs(r);
}

/** Щебень / песок / цемент — для bulk-заявок на отгрузку. */
export function isBulkOrderProduct(r: { item_type?: string | null; code?: string | null }): boolean {
  return isAggregate(r) || isCement(r);
}

/** Товар отгрузки: инерт + цемент + ФБС. */
export function isBulkShipmentProduct(r: { item_type?: string | null; code?: string | null }): boolean {
  return isAggregate(r) || isCement(r) || isFbs(r);
}

/**
 * Умный фильтр товара в заявке «Отгрузка»:
 * • цементовоз → только цемент (и марки завода из external_key cement:…);
 * • самосвал / тоннар → щебень/песок + ФБС (не цемент);
 * • точка aggregate → только инерт; concrete → только ФБС; mixed → всё, что допускает техника.
 */
export function matchesBulkShipmentProduct(
  r: { item_type?: string | null; code?: string | null; type?: string | null },
  opts: {
    vehicleKind?: string | null;
    loadingPoint?: { kind?: string | null; external_key?: string | null } | null;
  },
): boolean {
  if (!isBulkShipmentProduct(r)) return false;

  const vehicle = opts.vehicleKind || 'dump_truck';
  const point = opts.loadingPoint;
  const pointKind = point?.kind || null;
  const ext = String(point?.external_key || '');
  const cementKey = ext.startsWith('cement:') ? ext.slice('cement:'.length) : null;

  // Техника
  if (vehicle === 'cement_truck') {
    if (!isCement(r)) return false;
  } else {
    // Самосвал / тоннар / спец — инерт и ФБС, цемент только цементовозом
    if (isCement(r)) return false;
  }

  // Точка погрузки уточняет ассортимент
  if (!point) return true;

  if (pointKind === 'cement' || cementKey) {
    if (!isCement(r)) return false;
    if (cementKey) {
      const plant = cementPlantId(r);
      // Без привязки к заводу или с другим заводом — не показываем
      if (!plant || plant !== cementKey) return false;
    }
    return true;
  }

  if (pointKind === 'aggregate') return isAggregate(r);
  if (pointKind === 'concrete') return isFbs(r);
  // mixed / неизвестный — оставляем то, что пропустила техника
  return true;
}

export function productSection(r: { item_type?: string | null; code?: string | null }): ProductSection {
  if (isFbs(r)) return 'jbi';
  if (isCement(r)) return 'cement';
  if (isAggregate(r)) return 'aggregate';
  return 'concrete';
}

/** Допустимые type по секции (серверная валидация). */
export const CONCRETE_TYPES = new Set(['granite', 'dolomite', 'mortar', 'cps', 'lean', '']);
export const AGGREGATE_TYPES = new Set<AggregateKind>(['granite', 'dolomite', 'slag', 'sand']);
export const CEMENT_PLANT_TYPES = new Set<CementPlantId>(
  CEMENT_SUPPLIER_PLANTS.map((p) => p.id)
);

export function concreteKind(r: { code?: string | null; name?: string | null; type?: string | null }): ConcreteKind {
  const t = String(r.type || '').toLowerCase();
  if (t === 'mortar' || t === 'cps' || t === 'lean') return t;

  const code = String(r.code || '').toUpperCase().replace(/\s+/g, '');
  const name = String(r.name || '').toLowerCase();
  if (code.startsWith('ТР') || code.startsWith('TP') || name.includes('раствор')) return 'mortar';
  if (code.startsWith('ТБ') || code.startsWith('TB') || name.includes('тощий')) return 'lean';
  if (
    code.startsWith('ЦП') ||
    code.startsWith('CP') ||
    name.includes('пескоцемент') ||
    name.includes('цементно-песчан') ||
    name.includes('цп смесь')
  ) {
    return 'cps';
  }
  return 'concrete';
}

export function aggregateKind(r: { type?: string | null }): AggregateKind | null {
  const t = String(r.type || '').toLowerCase();
  if (t === 'granite' || t === 'dolomite' || t === 'slag' || t === 'sand') return t;
  return null;
}

export function aggregateKindLabel(kind: AggregateKind | null | undefined): string {
  if (!kind) return 'Вид не указан';
  return AGGREGATE_KINDS.find((k) => k.key === kind)?.label || kind;
}

export function cementPlantId(r: { type?: string | null }): CementPlantId | null {
  const t = String(r.type || '');
  return CEMENT_PLANT_TYPES.has(t as CementPlantId) ? (t as CementPlantId) : null;
}

export function cementPlantLabel(r: { type?: string | null }): string {
  const id = cementPlantId(r);
  if (!id) return 'Завод не указан';
  return getCementPlant(id)?.shortName || id;
}

/** Цена для отображения; для «по запросу» unit не клеим снаружи. */
export function formatProductPrice(r: {
  price?: number | null;
  item_type?: string | null;
  type?: string | null;
}): string {
  const price = Number(r.price);
  if ((isAggregate(r) || isCement(r)) && (!Number.isFinite(price) || price <= 0)) return 'по запросу';
  if (!Number.isFinite(price)) return '—';
  if (isCement(r)) {
    const rub = cementPriceRub(price, cementPlantId(r));
    return `${rub.toLocaleString('ru-RU')} ₽`;
  }
  return `${price.toLocaleString('ru-RU')} ₽`;
}

export function isOnRequestPrice(r: { price?: number | null; item_type?: string | null }): boolean {
  const price = Number(r.price);
  return (isAggregate(r) || isCement(r)) && (!Number.isFinite(price) || price <= 0);
}

export function priceUnit(r: {
  price?: number | null;
  item_type?: string | null;
  unit?: string | null;
  code?: string | null;
}): string {
  if (isOnRequestPrice(r)) return '';
  if (isCement(r)) return `/${r.unit || 'т'}`;
  if (isAggregate(r)) return `/${r.unit || 'м³'}`;
  if (isFbs(r)) return `/${r.unit || 'шт'}`;
  return '/м³';
}

/** Нормализация payload перед записью в recipes. */
export function sanitizeRecipePayload(body: Record<string, any>): { ok: true; data: Record<string, any> } | { ok: false; error: string } {
  const data = { ...body };
  delete data.change_note;
  delete data.changed_by;
  delete data.changed_by_name;

  const itemType = data.item_type == null || data.item_type === '' || data.item_type === 'concrete'
    ? null
    : String(data.item_type);

  const zeroMix = () => {
    for (const k of ['cement', 'sand', 'gravel', 'water', 'additive', 'additive2', 'strength_class', 'frost_resistance', 'water_resistance', 'slump']) {
      if (data[k] != null) {
        data[k] =
          k === 'sand' || k === 'gravel' || k === 'cement' || k === 'water' || k === 'additive' || k === 'additive2'
            ? 0
            : null;
      }
    }
  };

  if (itemType === 'aggregate') {
    data.item_type = 'aggregate';
    const t = String(data.type || '').toLowerCase();
    if (!AGGREGATE_TYPES.has(t as AggregateKind)) {
      return { ok: false, error: 'Для щебня/песка type должен быть granite|dolomite|slag|sand' };
    }
    data.type = t;
    data.unit = data.unit || 'м³';
    zeroMix();
    return { ok: true, data };
  }

  if (itemType === 'cement') {
    data.item_type = 'cement';
    const t = String(data.type || '');
    if (!CEMENT_PLANT_TYPES.has(t as CementPlantId)) {
      return {
        ok: false,
        error: 'Для цемента type должен быть fokino_cemros|kostyukovichi_bcz|krichev_kcsh',
      };
    }
    data.type = t;
    data.unit = data.unit || 'т';
    if (!String(data.code || '').trim()) {
      return { ok: false, error: 'Укажите код марки цемента' };
    }
    if (!String(data.name || '').trim()) {
      return { ok: false, error: 'Укажите название марки цемента' };
    }
    // В каталоге всегда ₽/т; старые значения в Br (<2000) конвертируем.
    data.price = cementPriceRub(Number(data.price), t as CementPlantId);
    zeroMix();
    return { ok: true, data };
  }

  if (itemType === 'fbs') {
    data.item_type = 'fbs';
    data.unit = data.unit || 'шт';
    return { ok: true, data };
  }

  if (itemType != null && itemType !== 'concrete') {
    return { ok: false, error: `Неизвестный item_type: ${itemType}` };
  }
  data.item_type = null;
  const t = String(data.type || '').toLowerCase();
  if (t && !CONCRETE_TYPES.has(t)) {
    return { ok: false, error: 'Для бетона type должен быть granite|dolomite|mortar|cps|lean' };
  }
  if (t) data.type = t;
  data.unit = data.unit || 'м³';
  return { ok: true, data };
}

/** Стартовый каталог щебня и песка из коммерческого предложения. */
export const AGGREGATE_SEED: Array<{
  code: string;
  name: string;
  type: AggregateKind;
  price: number;
  item_type: 'aggregate';
  unit: string;
  is_active: boolean;
  notes?: string;
}> = [
  { code: 'ЩГ-5-20', name: 'Щебень гранитный фр. 5-20', type: 'granite', price: 3700, item_type: 'aggregate', unit: 'м³', is_active: true },
  { code: 'ЩГ-20-40', name: 'Щебень гранитный фр. 20-40', type: 'granite', price: 3700, item_type: 'aggregate', unit: 'м³', is_active: true },
  { code: 'ЩГ-40-70', name: 'Щебень гранитный фр. 40-70', type: 'granite', price: 3700, item_type: 'aggregate', unit: 'м³', is_active: true },
  { code: 'ЩГ-др', name: 'Щебень гранитный другие фракции', type: 'granite', price: 0, item_type: 'aggregate', unit: 'м³', is_active: true, notes: 'по запросу' },
  { code: 'ЩД-5-20', name: 'Щебень доломитовый фр. 5-20', type: 'dolomite', price: 3000, item_type: 'aggregate', unit: 'м³', is_active: true },
  { code: 'ЩД-20-40', name: 'Щебень доломитовый фр. 20-40', type: 'dolomite', price: 2750, item_type: 'aggregate', unit: 'м³', is_active: true },
  { code: 'ЩД-40-70', name: 'Щебень доломитовый фр. 40-70', type: 'dolomite', price: 2750, item_type: 'aggregate', unit: 'м³', is_active: true },
  { code: 'ЩШ-0-20', name: 'Щебень шлаковый фр. 0-20', type: 'slag', price: 2500, item_type: 'aggregate', unit: 'м³', is_active: true },
  { code: 'ЩШ-20-40', name: 'Щебень шлаковый фр. 20-40', type: 'slag', price: 2500, item_type: 'aggregate', unit: 'м³', is_active: true },
  { code: 'ЩШ-40-70', name: 'Щебень шлаковый фр. 40-70', type: 'slag', price: 2500, item_type: 'aggregate', unit: 'м³', is_active: true },
  { code: 'П-намыв', name: 'Песок намывной (мытый желтый)', type: 'sand', price: 1000, item_type: 'aggregate', unit: 'м³', is_active: true },
  { code: 'П-строит', name: 'Песок строительный (серый)', type: 'sand', price: 800, item_type: 'aggregate', unit: 'м³', is_active: true },
  { code: 'П-форм', name: 'Формовочный песок б/у', type: 'sand', price: 300, item_type: 'aggregate', unit: 'м³', is_active: true },
];

function byCementNote(byn: number, source: string): string {
  const rub = bynToRub(byn);
  const bynTxt = byn.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${source}; ${bynTxt} Br/т → ${rub.toLocaleString('ru-RU')} ₽/т (курс ЦБ РФ ${BYN_TO_RUB_RATE} на ${BYN_TO_RUB_RATE_AS_OF})`;
}

/**
 * Стартовый каталог цемента.
 * Все цены в ₽/т. Для БЦЗ/КЦШ: прайс в Br переведён по курсу ЦБ РФ (см. BYN_TO_RUB_RATE).
 * 0 = «по запросу».
 */
export const CEMENT_SEED: Array<{
  code: string;
  name: string;
  type: CementPlantId;
  price: number;
  item_type: 'cement';
  unit: string;
  is_active: boolean;
  notes?: string;
}> = [
  // —— Фокино / ЦЕМРОС ——
  {
    code: 'Ц-ФОК-0-42.5Н',
    name: 'ЦЕМ 0 42,5Н',
    type: 'fokino_cemros',
    price: 0,
    item_type: 'cement',
    unit: 'т',
    is_active: true,
    notes: 'ГОСТ 31108-2020; бездобавочный; market.cemros.ru — по запросу',
  },
  {
    code: 'Ц-ФОК-I-42.5Н',
    name: 'ЦЕМ I 42,5Н',
    type: 'fokino_cemros',
    price: 9276,
    item_type: 'cement',
    unit: 'т',
    is_active: true,
    notes: 'ГОСТ 31108-2020; общестроительный; market.cemros.ru ≈ 9 275,66 ₽/т с НДС (навал/1 т)',
  },
  {
    code: 'Ц-ФОК-I-42.5Н-ЖИ',
    name: 'ЦЕМ I 42,5Н ЖИ',
    type: 'fokino_cemros',
    price: 8275,
    item_type: 'cement',
    unit: 'т',
    is_active: true,
    notes: 'ГОСТ Р 55224-2020; для ЖБИ и мостов; market.cemros.ru от 8 275,26 ₽/т',
  },

  // —— Костюковичи / БЦЗ (Br → ₽) ——
  {
    code: 'Ц-КОС-0-42.5Н',
    name: 'ЦЕМ 0 42,5Н',
    type: 'kostyukovichi_bcz',
    price: bynToRub(237.35),
    item_type: 'cement',
    unit: 'т',
    is_active: true,
    notes: byCementNote(237.35, 'ГОСТ 31108-2020; БЦК №705/01-10/2025 опт россыпь, отсрочка'),
  },
  {
    code: 'Ц-КОС-0-42.5Б',
    name: 'ЦЕМ 0 42,5Б',
    type: 'kostyukovichi_bcz',
    price: bynToRub(240.14),
    item_type: 'cement',
    unit: 'т',
    is_active: true,
    notes: byCementNote(240.14, 'ГОСТ 31108-2020; БЦК №705/01-10/2025 опт россыпь, отсрочка'),
  },
  {
    code: 'Ц-КОС-0-52.5Н',
    name: 'ЦЕМ 0 52,5Н',
    type: 'kostyukovichi_bcz',
    price: bynToRub(240.14),
    item_type: 'cement',
    unit: 'т',
    is_active: true,
    notes: byCementNote(240.14, 'ГОСТ 31108-2020; БЦК №705/01-10/2025 опт россыпь, отсрочка'),
  },
  {
    code: 'Ц-КОС-I-42.5Н',
    name: 'ЦЕМ I 42,5Н',
    type: 'kostyukovichi_bcz',
    price: bynToRub(238.1),
    item_type: 'cement',
    unit: 'т',
    is_active: true,
    notes: byCementNote(238.1, 'ГОСТ 31108-2020; БЦК №705/01-10/2025 опт россыпь, отсрочка'),
  },
  {
    code: 'Ц-КОС-I-42.5Б',
    name: 'ЦЕМ I 42,5Б',
    type: 'kostyukovichi_bcz',
    price: bynToRub(241.73),
    item_type: 'cement',
    unit: 'т',
    is_active: true,
    notes: byCementNote(241.73, 'ГОСТ 31108-2020; БЦК №705/01-10/2025 опт россыпь, отсрочка'),
  },
  {
    code: 'Ц-КОС-I-52.5Н',
    name: 'ЦЕМ I 52,5Н',
    type: 'kostyukovichi_bcz',
    price: 0,
    item_type: 'cement',
    unit: 'т',
    is_active: true,
    notes: 'ГОСТ 31108-2020; в открытом прейскуранте БЦЗ на 01.10.2025 не найден — уточнять у завода',
  },

  // —— Кричев / КЦШ (Br → ₽) ——
  {
    code: 'Ц-КРИ-0-42.5Н',
    name: 'ЦЕМ 0 42,5Н',
    type: 'krichev_kcsh',
    price: bynToRub(243.17),
    item_type: 'cement',
    unit: 'т',
    is_active: true,
    notes: byCementNote(243.17, 'ГОСТ 31108-2020; БЦК №736/01-10/2025 опт россыпь авто, предоплата'),
  },
  {
    code: 'Ц-КРИ-0-42.5Б',
    name: 'ЦЕМ 0 42,5Б',
    type: 'krichev_kcsh',
    price: bynToRub(243.17),
    item_type: 'cement',
    unit: 'т',
    is_active: true,
    notes: byCementNote(243.17, 'ГОСТ 31108-2020; БЦК №736/01-10/2025 опт россыпь авто, предоплата'),
  },
  {
    code: 'Ц-КРИ-0-52.5Н',
    name: 'ЦЕМ 0 52,5Н',
    type: 'krichev_kcsh',
    price: bynToRub(247.03),
    item_type: 'cement',
    unit: 'т',
    is_active: true,
    notes: byCementNote(247.03, 'ГОСТ 31108-2020; БЦК №736/01-10/2025 опт россыпь авто, предоплата'),
  },
  {
    code: 'Ц-КРИ-0-52.5Б',
    name: 'ЦЕМ 0 52,5Б',
    type: 'krichev_kcsh',
    price: bynToRub(247.03),
    item_type: 'cement',
    unit: 'т',
    is_active: true,
    notes: byCementNote(247.03, 'ГОСТ 31108-2020; БЦК №736/01-10/2025 опт россыпь авто, предоплата'),
  },
  {
    code: 'Ц-КРИ-I-42.5Н',
    name: 'ЦЕМ I 42,5Н',
    type: 'krichev_kcsh',
    price: bynToRub(237.14),
    item_type: 'cement',
    unit: 'т',
    is_active: true,
    notes: byCementNote(237.14, 'ГОСТ 31108-2020; БЦК №736/01-10/2025 опт россыпь авто, предоплата'),
  },
  {
    code: 'Ц-КРИ-I-42.5Б',
    name: 'ЦЕМ I 42,5Б',
    type: 'krichev_kcsh',
    price: bynToRub(242.39),
    item_type: 'cement',
    unit: 'т',
    is_active: true,
    notes: byCementNote(242.39, 'ГОСТ 31108-2020; БЦК №736/01-10/2025 опт россыпь авто, предоплата'),
  },
  {
    code: 'Ц-КРИ-I-52.5Н',
    name: 'ЦЕМ I 52,5Н',
    type: 'krichev_kcsh',
    price: bynToRub(246.25),
    item_type: 'cement',
    unit: 'т',
    is_active: true,
    notes: byCementNote(246.25, 'ГОСТ 31108-2020; БЦК №736/01-10/2025 опт россыпь авто, предоплата'),
  },
  {
    code: 'Ц-КРИ-I-52.5Б',
    name: 'ЦЕМ I 52,5Б',
    type: 'krichev_kcsh',
    price: bynToRub(246.25),
    item_type: 'cement',
    unit: 'т',
    is_active: true,
    notes: byCementNote(246.25, 'ГОСТ 31108-2020; БЦК №736/01-10/2025 опт россыпь авто, предоплата'),
  },
];
