/**
 * Чистые хелперы адресов Брянска — без 'use client', можно на сервере.
 * (Не тянуть из lib/yandexRoute.ts в API/RSC.)
 */

export const ROUTE_ORIGIN_ADDRESS = 'Брянск, Орловский тупик, 6';

let routeOriginAddressOverride: string | null = null;

export function setRouteOriginAddressOverride(address: string | null | undefined): void {
  const t = String(address || '').trim();
  routeOriginAddressOverride = t || null;
}

export function getRouteOriginAddress(): string {
  return routeOriginAddressOverride || ROUTE_ORIGIN_ADDRESS;
}

const KNOWN_LANDMARKS: { keywords: string[]; address: string }[] = [
  { keywords: ['варяг'], address: 'Брянск, улица Дуки, 56В' },
];

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

  const lower = trimmed.toLowerCase();
  if (KNOWN_LANDMARKS.some((l) => l.keywords.some((kw) => lower.includes(kw)))) return false;

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

  const lower = trimmed.toLowerCase();

  const landmark = KNOWN_LANDMARKS.find((l) => l.keywords.some((kw) => lower.includes(kw)));
  if (landmark) return landmark.address;

  if (mentionsBryanskRegion(trimmed)) return trimmed;
  if (mentionsBryanskCity(trimmed)) return trimmed;

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
