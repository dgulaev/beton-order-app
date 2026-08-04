/**
 * Серверное геокодирование адреса (DaData) + чистые geo-хелперы без 'use client'.
 * (Не импортировать из lib/yandexRoute.ts на сервере — там 'use client'.)
 */

import { isPickupOrder } from '@/lib/bryanskAddress';

const DADATA_URL = 'https://suggestions.dadata.ru/suggestions/api/4_1/rs/suggest/address';

export type GeocodeCoords = { lat: number; lon: number };
export type Coords = GeocodeCoords;

/** Координаты своего БСУ (Брянск, Орловский тупик, 6) — fallback. */
export const ROUTE_ORIGIN_COORDS: Coords = { lat: 53.25347, lon: 34.416444 };

/** Переопределение из Настройки → Завод / гео (клиент + сервер). */
let routeOriginCoordsOverride: Coords | null = null;

export function setRouteOriginCoordsOverride(coords: Coords | null | undefined): void {
  if (
    coords &&
    Number.isFinite(coords.lat) &&
    Number.isFinite(coords.lon)
  ) {
    routeOriginCoordsOverride = { lat: coords.lat, lon: coords.lon };
    return;
  }
  routeOriginCoordsOverride = null;
}

/** Актуальные координаты БСУ (настройки или hardcode). */
export function getRouteOriginCoords(): Coords {
  return routeOriginCoordsOverride || ROUTE_ORIGIN_COORDS;
}

/**
 * Координаты из текста адреса, если диспетчер вставил "52.735700, 34.774616".
 */
export function extractCoordsFromAddress(address: string | null | undefined): Coords | null {
  if (!address) return null;
  const match = address.match(/(\d{2,3}\.\d{2,})[,\s]+(\d{2,3}\.\d{2,})/);
  if (!match) return null;
  const lat = parseFloat(match[1]);
  const lon = parseFloat(match[2]);
  if (lat >= 41 && lat <= 82 && lon >= 19 && lon <= 170) {
    return { lat, lon };
  }
  return null;
}

type DadataSuggestion = {
  value?: string;
  data: {
    geo_lat: string | null;
    geo_lon: string | null;
    street?: string | null;
    settlement?: string | null;
    city?: string | null;
  };
};

/** DaData стабильнее на полных словах, чем на «пгт» / «г.» / «д.». */
export function prepareGeocodeQuery(raw: string): string {
  let q = String(raw || '').trim();
  if (!q) return q;
  q = q.replace(/(^|[\s,./])р-?н\.?(?=$|[\s,.])/gi, '$1район');
  q = q.replace(/(^|[\s,])пгт\.?\s*(?=[А-ЯЁA-Z])/gi, '$1посёлок городского типа ');
  q = q.replace(/(^|[\s,])г\.\s*(?=[А-ЯЁA-Z])/gi, '$1город ');
  q = q.replace(/(^|[\s,])д\.\s*(?=[А-ЯЁA-Z])/gi, '$1деревня ');
  q = q.replace(/(^|[\s,])п\.\s*(?=[А-ЯЁA-Z])/gi, '$1посёлок ');
  q = q.replace(/(^|[\s,])с\.\s*(?=[А-ЯЁA-Z])/gi, '$1село ');
  return q.replace(/\s{2,}/g, ' ').replace(/\s+,/g, ',').trim();
}

function foldYo(value: string): string {
  return value.replace(/ё/g, 'е').replace(/Ё/g, 'Е');
}

/** Имя НП из начала запроса («Выгоничи» из «пгт Выгоничи, Брянская область»). */
function extractSettlementNeedle(query: string): string | null {
  let q = foldYo(query)
    .replace(/,?\s*Брянская\s*область\.?/gi, '')
    .replace(
      /(?:посёлок городского типа|поселок городского типа|посёлок|поселок|деревня|село|город)\s+/gi,
      '',
    )
    .replace(/\b(?:пгт|г|с|д|п)\.\s*/gi, '')
    .trim();
  const first = foldYo(q.split(',')[0] || '')
    .trim()
    .toLowerCase();
  if (!first || first.length < 2) return null;
  if (/брянск/.test(first)) return null;
  return first;
}

function suggestionPlaceName(s: DadataSuggestion): string {
  return foldYo(
    String(s.data.settlement || s.data.city || s.value || '').toLowerCase(),
  );
}

function coordsOf(s: DadataSuggestion): GeocodeCoords {
  return {
    lat: parseFloat(s.data.geo_lat!),
    lon: parseFloat(s.data.geo_lon!),
  };
}

function haversineKm(a: GeocodeCoords, b: GeocodeCoords): number {
  const R = 6371;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

/** Точка у завода/центра — подозрительна для адреса «за городом» (Выгоничи и т.п.). */
function isTooCloseToPlant(coords: GeocodeCoords): boolean {
  return haversineKm(coords, getRouteOriginCoords()) < 8;
}

async function suggest(query: string): Promise<DadataSuggestion[]> {
  const token = process.env.DADATA_API_KEY;
  if (!token) return [];

  const res = await fetch(DADATA_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Token ${token}`,
    },
    body: JSON.stringify({
      query,
      count: 8,
      locations: [{ region: 'Брянская' }],
    }),
  });

  if (!res.ok) return [];
  const data = await res.json();
  return data?.suggestions || [];
}

function placeMatchesNeedle(place: string, needle: string): boolean {
  const p = place.split(',')[0].trim();
  // Важно: "".includes — всегда true; пустое place нельзя считать совпадением
  // (иначе любая «кривая» подсказка DaData становилась «Выгоничи» → центр Брянска).
  if (!needle || needle.length < 2 || !p || p.length < 2) return false;
  return p.includes(needle) || needle.includes(p);
}

/**
 * Выбор подсказки: совпадение имени НП > «НП без улицы» > первая с координатами.
 * Для запросов с именем НП («Выгоничи») отбрасываем точки у завода/центра города.
 */
function pickBestSuggestion(
  suggestions: DadataSuggestion[],
  opts: { needle: string | null; rejectNearPlant: boolean },
): DadataSuggestion | null {
  let withCoords = suggestions.filter((s) => s.data.geo_lat && s.data.geo_lon);
  if (withCoords.length === 0) return null;

  if (opts.needle) {
    const byName = withCoords.filter((s) =>
      placeMatchesNeedle(suggestionPlaceName(s), opts.needle!),
    );
    if (byName.length > 0) {
      if (opts.rejectNearPlant) {
        const far = byName.filter((s) => !isTooCloseToPlant(coordsOf(s)));
        if (far.length > 0) return far[0];
      }
      return byName[0];
    }
    // Имени НП в ответе нет — не берём «первую попавшуюся» у завода.
    if (opts.rejectNearPlant) {
      const far = withCoords.filter((s) => !isTooCloseToPlant(coordsOf(s)));
      if (far.length === 0) return null;
      withCoords = far;
    }
  }

  const settlementOnly = withCoords.find(
    (s) => s.data.settlement && !String(s.data.street || '').trim(),
  );
  return settlementOnly || withCoords[0];
}

/**
 * Упрощение запроса при пустом ответе DaData.
 * Не выкидываем «Брянская обл» / «… район» — иначе «д. Заречная» матчится
 * как улица в городе. Сначала снимаем дом/улицу, регион оставляем дольше.
 */
function trimQueryForRetry(query: string): string | null {
  const parts = query.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length <= 1) return null;

  const isRegionOrDistrict = (p: string) =>
    /брянск[а-яё]*\s*обл/i.test(p)
    || /(^|[\s,./])(?:район|р-?н)(?:$|[\s,.])/i.test(` ${p} `);

  // С конца, но пропускаем регион/район — режем улицу/дом перед ними.
  for (let i = parts.length - 1; i >= 1; i--) {
    if (isRegionOrDistrict(parts[i])) continue;
    parts.splice(i, 1);
    return parts.join(', ');
  }

  // Остались только НП + район/область — убрать самый левый кусок (лишняя улица).
  parts.shift();
  return parts.length ? parts.join(', ') : null;
}

/**
 * Геокодирует адрес с упрощением хвоста, если точного совпадения нет.
 */
export async function geocodeAddressWithFallback(rawQuery: string): Promise<GeocodeCoords | null> {
  const original = String(rawQuery || '').trim();
  if (!original) return null;

  // Самовывоз → завод (не «г. Брянск, Самовывоз» через DaData).
  if (isPickupOrder(original)) return getRouteOriginCoords();

  // Ориентиры/вставка «lat, lon» в адресе — без DaData (и без ключа).
  const embedded = extractCoordsFromAddress(original);
  if (embedded) return embedded;

  if (!process.env.DADATA_API_KEY) return null;

  const query = prepareGeocodeQuery(original);
  const needle = extractSettlementNeedle(original);
  // Есть явное имя НП вне «г. Брянск» — не принимаем геокод в центре/у завода.
  const rejectNearPlant = Boolean(needle);

  const bareSettlement = needle
    ? `${needle.charAt(0).toUpperCase()}${needle.slice(1)}, Брянская область`
    : null;

  const tried = new Set<string>();
  const queue: string[] = [query];
  if (bareSettlement && foldYo(bareSettlement).toLowerCase() !== foldYo(query).toLowerCase()) {
    queue.push(bareSettlement);
  }

  while (queue.length > 0 && tried.size < 8) {
    const current = queue.shift()!;
    const key = foldYo(current).toLowerCase();
    if (tried.has(key)) continue;
    tried.add(key);

    const suggestions = await suggest(current);
    const best = pickBestSuggestion(suggestions, { needle, rejectNearPlant });
    if (best) {
      const coords = coordsOf(best);
      if (rejectNearPlant && isTooCloseToPlant(coords)) {
        // НП области не должен схлопываться в центр Брянска
      } else {
        return coords;
      }
    }

    const next = trimQueryForRetry(current);
    if (next && !tried.has(foldYo(next).toLowerCase())) queue.push(next);
  }

  return null;
}
