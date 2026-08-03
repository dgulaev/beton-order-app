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

  // Населённый пункт не указан — считаем, что это Брянск.
  return `г. Брянск, ${trimmed}`;
}
