/**
 * Чистые хелперы адресов Брянска — без 'use client', можно на сервере.
 * (Не тянуть из lib/yandexRoute.ts в API/RSC.)
 */

import {
  BRYANSK_CITY_AREAS,
  BRYANSK_LANDMARKS,
  type BryanskCityArea,
  type BryanskLandmark,
} from './bryanskLandmarks';
import {
  extractGardenPlotKey,
  resolveGardenPlotCoords,
} from './bryanskGardenPlots';

export const ROUTE_ORIGIN_ADDRESS = 'Брянск, Орловский тупик, 6';

let routeOriginAddressOverride: string | null = null;

export function setRouteOriginAddressOverride(address: string | null | undefined): void {
  const t = String(address || '').trim();
  routeOriginAddressOverride = t || null;
}

export function getRouteOriginAddress(): string {
  return routeOriginAddressOverride || ROUTE_ORIGIN_ADDRESS;
}

/**
 * Самовывоз: клиент забирает бетон на заводе.
 * Не геокодировать как адрес доставки (иначе «г. Брянск, Самовывоз» → центр города).
 * Важно: целое слово — «Самовывозников» / street names не считаем самовывозом.
 */
export function isPickupOrder(address?: string | null): boolean {
  const raw = foldYo(String(address || '').toLowerCase()).trim();
  if (!raw) return false;
  // Границы без \\b (в JS плохо с кириллицей).
  if (/(^|[^а-яa-z0-9])самовывоз([^а-яa-z0-9]|$)/i.test(raw)) return true;
  if (/(^|[^a-z0-9])self-?pickup([^a-z0-9]|$)/i.test(raw)) return true;
  // Голое английское pickup — только если адрес без кириллицы (иначе слишком широко).
  if (!/[а-я]/i.test(raw) && /(^|[^a-z0-9])pickup([^a-z0-9]|$)/i.test(raw)) return true;
  return false;
}

/**
 * Ориентиры (ЖК / КП / мкр / ТЦ / СО·СНТ): менеджеры пишут коротко («ЖК Рай»,
 * «СО Фрунзе»), DaData часто ставит центр города. Справочник —
 * lib/bryanskLandmarks.ts; один список на десктоп и мобилку через
 * `normalizeDeliveryAddress`. Вариации «сад. общество» / «СНТ» / «им.» → «со».
 */
type KnownLandmark = BryanskLandmark;

/**
 * Схлопываем написания садовых обществ к маркеру «со …».
 * Иначе «Садовое общество Фрунзе» / «сад. общ. Фрунзе» / «СНТ Фрунзе»
 * не матчятся со справочником (keyword `со фрунзе`) и геокодер
 * кидает точку в центр Брянска.
 */
function normalizeGardenSocietyMarkers(value: string): string {
  let t = value;
  const toSo = [
    // длинные формы — раньше коротких
    /садоводческ[а-яё]*\s+некоммерческ[а-яё]*\s+товариществ[а-яё]*/g,
    /садов(?:одческ)?[а-яё]*\s+некоммерческ[а-яё]*\s+товариществ[а-яё]*/g,
    /садоводческ[а-яё]*\s+(?:объединени[а-яё]*|обществ[а-яё]*|товариществ[а-яё]*)/g,
    /садов(?:ое|ого|ому|ым|ом|ые|ых|ыми)?\s+(?:объединени[а-яё]*|обществ[а-яё]*|товариществ[а-яё]*)/g,
    /сад\.?\s*общ(?:еств[а-яё]*)?\.?/g,
    /сад\.?\s*тов(?:ариществ[а-яё]*)?\.?/g,
    /сад\.?\s*объединен(?:и[а-яё]*)?\.?/g,
    /\bснт\.?\b/g,
    /\bдн[тс]\.?\b/g,
    /\bонт\.?\b/g,
    /\bс\/о\b/g,
    /\bс\.о\.\b/g,
  ];
  for (const re of toSo) {
    t = t.replace(re, ' со ');
  }
  // «им. Фрунзе» / «имени Фрунзе» после маркера СО
  t = t.replace(/\bсо\s+(?:им\.?|имени)\s+/g, 'со ');
  // дефисы в именах: «Дормаш-1» = «Дормаш 1»
  t = t.replace(/-/g, ' ');
  return t.replace(/\s+/g, ' ').trim();
}

/** Схлопываем кавычки/ё — чтобы «ЖК «Рай»» матчился по keyword `жк рай`. */
function foldLandmarkText(value: string): string {
  return normalizeGardenSocietyMarkers(
    foldYo(value)
      .toLowerCase()
      .replace(/[«»„“”"']/g, '')
      .replace(/\s+/g, ' ')
      .trim(),
  );
}

function landmarkToQuery(landmark: KnownLandmark, rawAddress?: string): string {
  // СО/СНТ: если в адресе есть участок — берём координаты дома из справочника
  // (86/1 → 86, если дроби нет в ginfo). Иначе — центр СО.
  if (landmark.gardenSocietyId && rawAddress) {
    const plotKey = extractGardenPlotKey(rawAddress);
    const plot = resolveGardenPlotCoords(landmark.gardenSocietyId, plotKey);
    const lat = plot?.lat ?? landmark.lat;
    const lon = plot?.lon ?? landmark.lon;
    if (
      typeof lat === 'number' &&
      typeof lon === 'number' &&
      Number.isFinite(lat) &&
      Number.isFinite(lon)
    ) {
      const plotSuffix = plotKey ? `, участок ${plotKey}` : '';
      return `${landmark.label}${plotSuffix}, ${lat}, ${lon}`;
    }
  }

  if (
    typeof landmark.lat === 'number' &&
    typeof landmark.lon === 'number' &&
    Number.isFinite(landmark.lat) &&
    Number.isFinite(landmark.lon)
  ) {
    return `${landmark.label}, ${landmark.lat}, ${landmark.lon}`;
  }
  return landmark.address || landmark.label;
}

/** Keyword как целое слово/фраза: «посёлок рай» ≠ «посёлок райский». */
function landmarkKeywordMatches(hay: string, kw: string): boolean {
  let from = 0;
  while (true) {
    const idx = hay.indexOf(kw, from);
    if (idx === -1) return false;
    const before = idx > 0 ? hay[idx - 1] : '';
    const after = idx + kw.length < hay.length ? hay[idx + kw.length] : '';
    const beforeOk = !before || !CYRILLIC_LETTER.test(before);
    const afterOk = !after || !CYRILLIC_LETTER.test(after);
    if (beforeOk && afterOk) return true;
    from = idx + 1;
  }
}

/** Самое длинное совпадение keyword — чтобы более точная фраза выигрывала. */
function findKnownLandmark(raw: string): KnownLandmark | null {
  const hay = foldLandmarkText(raw);
  if (!hay) return null;

  let best: { landmark: KnownLandmark; len: number } | null = null;
  for (const landmark of BRYANSK_LANDMARKS) {
    for (const kwRaw of landmark.keywords) {
      const kw = foldLandmarkText(kwRaw);
      if (kw.length < 3) continue;
      if (!landmarkKeywordMatches(hay, kw)) continue;
      if (!best || kw.length > best.len) {
        best = { landmark, len: kw.length };
      }
    }
  }
  return best?.landmark ?? null;
}

function cityAreaKeys(area: BryanskCityArea): string[] {
  return [area.name, ...(area.aliases || [])];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * «Ходаринка, ул. Ольховская 52» → area + rest улицы;
 * «мкр Ходаринка» / голое «Ходаринка» → area без rest.
 */
function matchCityArea(
  trimmed: string,
): { area: BryanskCityArea; rest: string } | null {
  let best: { area: BryanskCityArea; rest: string; keyLen: number } | null = null;

  for (const area of BRYANSK_CITY_AREAS) {
    for (const keyRaw of cityAreaKeys(area)) {
      const key = foldLandmarkText(keyRaw);
      if (key.length < 3) continue;
      const keyRe = escapeRegExp(keyRaw).replace(/ё/gi, '[её]');

      // префикс: «Ходаринка, …» / «мкр Ходаринка, …»
      const prefixRe = new RegExp(
        `^(?:мкр\\.?\\s+|микрорайон\\s+|район\\s+|р-н\\.?\\s+)?${keyRe}\\s*(?:,\\s*|\\s+|$)`,
        'i',
      );
      const prefixHit = trimmed.match(prefixRe);
      if (prefixHit) {
        const rest = trimmed.slice(prefixHit[0].length).trim();
        if (!best || key.length > best.keyLen) {
          best = { area, rest, keyLen: key.length };
        }
      }

      // суффикс: «ул. Ольховская 52, Ходаринка»
      const suffixRe = new RegExp(
        `[,\\s]+(?:мкр\\.?\\s+|микрорайон\\s+|район\\s+|р-н\\.?\\s+)?${keyRe}\\s*$`,
        'i',
      );
      if (suffixRe.test(trimmed)) {
        const rest = trimmed.replace(suffixRe, '').trim();
        if (rest && (!best || key.length > best.keyLen)) {
          best = { area, rest, keyLen: key.length };
        }
      }
    }
  }

  return best ? { area: best.area, rest: best.rest } : null;
}

function cityAreaToQuery(area: BryanskCityArea): string {
  return `Брянск, ${area.name}, ${area.lat}, ${area.lon}`;
}

/**
 * Маркер населённого пункта вне «голой» улицы Брянска.
 * Важно: `д.` (деревня) и `п.` (посёлок) — частые сокращения диспетчеров;
 * без них «д. Заречная» нормализуется в «г. Брянск, …» и геокодер
 * находит одноимённую улицу в городе.
 * Длинные формы — раньше коротких (`деревня` до `д.`, `посёлок` до `п.`).
 */
const SETTLEMENT_MARKER =
  /(?:^|[\s,])(город|гор\.|г\.?|посёлок|поселок|поселение|пос\.?|пгт\.?|рп\.?|село|с\.|деревня|дер\.?|д\.|станица|ст\.?|хутор|х\.|п\.)\s*[А-ЯЁ]/i;

/** Район без типа НП («Комаричский р-н») — тоже не городская улица. */
const DISTRICT_MARKER =
  /(?:^|[\s,./])(?:р-?н|район)(?:$|[\s,.])/i;

const CYRILLIC_LETTER = /[а-яё]/i;

/** Тип НП для подстановки в запрос геокодера. */
export type SettlementType = 'г.' | 'пгт' | 'с.' | 'д.' | 'п.';

type KnownSettlement = {
  /** Каноническое имя для геокодера. */
  name: string;
  type: SettlementType;
  /** Доп. написания (без регистра; ё/е сравниваются одинаково). */
  aliases?: string[];
};

/**
 * Известные НП Брянской области: менеджеры часто пишут только название
 * («Навля», «Сельцо», «Толмачево») — без типа и области геокодер путает
 * с улицей в Брянске. Брянск сюда не включаем: для него своя логика.
 *
 * Города и пгт — полный список; сёла/деревни/посёлки — частые направления
 * доставки (особенно вокруг Брянска) + районные центры-сёла.
 */
const KNOWN_SETTLEMENTS: KnownSettlement[] = [
  // Города (кроме Брянска)
  { name: 'Дятьково', type: 'г.' },
  { name: 'Жуковка', type: 'г.' },
  { name: 'Злынка', type: 'г.' },
  { name: 'Карачев', type: 'г.' },
  { name: 'Клинцы', type: 'г.' },
  { name: 'Мглин', type: 'г.' },
  { name: 'Новозыбков', type: 'г.' },
  { name: 'Почеп', type: 'г.' },
  { name: 'Севск', type: 'г.' },
  { name: 'Сельцо', type: 'г.' },
  { name: 'Стародуб', type: 'г.' },
  { name: 'Сураж', type: 'г.' },
  { name: 'Трубчевск', type: 'г.' },
  { name: 'Унеча', type: 'г.' },
  { name: 'Фокино', type: 'г.' },

  // Пгт
  { name: 'Алтухово', type: 'пгт' },
  { name: 'Белая Берёзка', type: 'пгт', aliases: ['Белая Березка'] },
  { name: 'Белые Берега', type: 'пгт' },
  { name: 'Большое Полпино', type: 'пгт', aliases: ['Полпино'] },
  { name: 'Бытошь', type: 'пгт' },
  { name: 'Выгоничи', type: 'пгт' },
  { name: 'Вышков', type: 'пгт' },
  { name: 'Дубровка', type: 'пгт' },
  { name: 'Ивот', type: 'пгт' },
  { name: 'Клетня', type: 'пгт' },
  { name: 'Климово', type: 'пгт' },
  { name: 'Кокоревка', type: 'пгт' },
  { name: 'Комаричи', type: 'пгт' },
  { name: 'Красная Гора', type: 'пгт' },
  { name: 'Локоть', type: 'пгт' },
  { name: 'Любохна', type: 'пгт' },
  { name: 'Навля', type: 'пгт' },
  { name: 'Погар', type: 'пгт' },
  { name: 'Радица-Крыловка', type: 'пгт', aliases: ['Радица Крыловка'] },
  { name: 'Рамасуха', type: 'пгт' },
  { name: 'Рогнедино', type: 'пгт' },
  { name: 'Старь', type: 'пгт' },
  { name: 'Суземка', type: 'пгт' },

  // Частые сёла / деревни / посёлки (особенно вокруг Брянска)
  { name: 'Толмачево', type: 'с.' },
  { name: 'Толвинка', type: 'п.' },
  { name: 'Супонево', type: 'п.' },
  { name: 'Путёвка', type: 'п.', aliases: ['Путевка'] },
  { name: 'Глинищево', type: 'с.' },
  { name: 'Кокино', type: 'с.' },
  { name: 'Добрунь', type: 'с.' },
  { name: 'Свень', type: 'п.' },
  { name: 'Пальцо', type: 'п.' },
  { name: 'Ржаница', type: 'п.' },
  { name: 'Мичуринский', type: 'п.' },
  { name: 'Отрадное', type: 'с.' },
  { name: 'Чернетово', type: 'с.' },
  { name: 'Новые Дарковичи', type: 'с.', aliases: ['Дарковичи'] },
  { name: 'Старые Дарковичи', type: 'д.' },
  { name: 'Хотылёво', type: 'с.', aliases: ['Хотылево'] },
  { name: 'Теменичи', type: 'с.' },
  { name: 'Журиничи', type: 'с.' },
  { name: 'Бетово', type: 'с.' },
  { name: 'Нетьинка', type: 'п.' },
  { name: 'Титовка', type: 'д.' },
  { name: 'Новосёлки', type: 'д.', aliases: ['Новоселки'] },
  { name: 'Смольянь', type: 'с.' },
  { name: 'Городище', type: 'п.' },
  { name: 'Ардонь', type: 'п.' },
  { name: 'Займище', type: 'п.' },
  { name: 'Лопандино', type: 'п.' },
  { name: 'Мирный', type: 'п.' },
  { name: 'Сеща', type: 'с.' },
  { name: 'Вщиж', type: 'с.' },
  { name: 'Новое Место', type: 'с.' },
];

function foldYo(value: string): string {
  return value.replace(/ё/g, 'е').replace(/Ё/g, 'Е');
}

function settlementKeys(s: KnownSettlement): string[] {
  return [s.name, ...(s.aliases || [])];
}

/** Длинные имена раньше коротких («Большое Полпино» до «Полпино»). */
const KNOWN_SETTLEMENTS_BY_KEY_LEN = [...KNOWN_SETTLEMENTS].sort((a, b) => {
  const aMax = Math.max(...settlementKeys(a).map((k) => foldYo(k).length));
  const bMax = Math.max(...settlementKeys(b).map((k) => foldYo(k).length));
  return bMax - aMax;
});

/**
 * Голое имя НП в начале адреса («Навля», «Навля, ул. Ленина»).
 * Не срабатывает на «Навлянский р-н» — после имени должна быть граница.
 */
function matchKnownSettlementPrefix(
  trimmed: string,
): { settlement: KnownSettlement; rest: string } | null {
  const lowerFolded = foldYo(trimmed.toLowerCase());

  for (const settlement of KNOWN_SETTLEMENTS_BY_KEY_LEN) {
    for (const keyRaw of settlementKeys(settlement)) {
      const key = foldYo(keyRaw.toLowerCase());
      if (!lowerFolded.startsWith(key)) continue;
      const after = lowerFolded.slice(key.length);
      if (after !== '' && !/^[\s,./]/.test(after)) continue;
      const rest = trimmed.slice(key.length).replace(/^[\s,./]+/, '').trim();
      return { settlement, rest };
    }
  }
  return null;
}

function formatKnownSettlement(settlement: KnownSettlement, rest: string): string {
  const head = `${settlement.type} ${settlement.name}`;
  const body = rest ? `${head}, ${rest}` : head;
  return `${body}, Брянская область`;
}

function hasWholeWord(haystack: string, word: string): boolean {
  const lower = haystack.toLowerCase();
  let fromIndex = 0;
  while (true) {
    const idx = lower.indexOf(word, fromIndex);
    if (idx === -1) return false;
    const before = idx > 0 ? lower[idx - 1] : '';
    const after = idx + word.length < lower.length ? lower[idx + word.length] : '';
    if (!CYRILLIC_LETTER.test(before) && !CYRILLIC_LETTER.test(after)) return true;
    fromIndex = idx + 1;
  }
}

export function mentionsBryanskCity(address: string): boolean {
  return hasWholeWord(address, 'брянск');
}

function mentionsBryanskRegion(address: string): boolean {
  return /брянск[а-яё]*\s*обл/i.test(address);
}

/** Адрес за пределами города Брянска (для тарифа «за городом»). */
export function isOutsideBryansk(rawAddress: string | null | undefined): boolean {
  const trimmed = (rawAddress || '').trim();
  if (!trimmed) return false;

  if (isPickupOrder(trimmed)) return false;
  if (findKnownLandmark(trimmed)) return false;
  if (matchCityArea(trimmed)) return false;

  if (mentionsBryanskCity(trimmed)) return false;
  if (mentionsBryanskRegion(trimmed)) return true;
  if (SETTLEMENT_MARKER.test(trimmed)) return true;
  if (DISTRICT_MARKER.test(trimmed)) return true;
  if (matchKnownSettlementPrefix(trimmed)) return true;

  return false;
}

/** Нормализация адреса доставки для геокодера / карт. */
export function normalizeDeliveryAddress(rawAddress: string | null | undefined): string {
  const trimmed = (rawAddress || '').trim();
  if (!trimmed) return ROUTE_ORIGIN_ADDRESS;

  // Самовывоз = точка завода, не «г. Брянск, Самовывоз» (центр города).
  if (isPickupOrder(trimmed)) return getRouteOriginAddress();

  const landmark = findKnownLandmark(trimmed);
  if (landmark) return landmarkToQuery(landmark, trimmed);

  // Городской район/слобода: с улицей — геокодим улицу; без — точку района.
  // Иначе DaData на «Ходаринка, ул. …» ставит центр Брянска.
  const cityArea = matchCityArea(trimmed);
  if (cityArea) {
    if (cityArea.rest) {
      return normalizeDeliveryAddress(cityArea.rest);
    }
    return cityAreaToQuery(cityArea.area);
  }

  // Уже с «г. Брянск, …» — всё равно выкидываем «Ходаринка» из середины.
  if (mentionsBryanskCity(trimmed)) {
    const afterCity = trimmed
      .replace(/^(?:г\.?\s*)?брянск\.?\s*,?\s*/i, '')
      .trim();
    const nested = matchCityArea(afterCity);
    if (nested) {
      if (nested.rest) return `г. Брянск, ${nested.rest}`;
      return cityAreaToQuery(nested.area);
    }
    return trimmed;
  }

  if (mentionsBryanskRegion(trimmed)) return trimmed;

  if (SETTLEMENT_MARKER.test(trimmed) || DISTRICT_MARKER.test(trimmed)) {
    return `${trimmed}, Брянская область`;
  }

  const known = matchKnownSettlementPrefix(trimmed);
  if (known) {
    return formatKnownSettlement(known.settlement, known.rest);
  }

  // Населённый пункт не указан — считаем, что это Брянск.
  return `г. Брянск, ${trimmed}`;
}
