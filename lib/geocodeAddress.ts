/**
 * Серверное геокодирование адреса (DaData) + чистые geo-хелперы без 'use client'.
 * (Не импортировать из lib/yandexRoute.ts на сервере — там 'use client'.)
 */

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
      count: 5,
      locations: [{ region: 'Брянская' }],
    }),
  });

  if (!res.ok) return [];
  const data = await res.json();
  return data?.suggestions || [];
}

/** НП целиком (деревня без улицы) важнее «ул. Заречная» в другом селе. */
function pickBestSuggestion(suggestions: DadataSuggestion[]): DadataSuggestion | null {
  const withCoords = suggestions.filter((s) => s.data.geo_lat && s.data.geo_lon);
  if (withCoords.length === 0) return null;
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
  let query = String(rawQuery || '').trim();
  if (!query || !process.env.DADATA_API_KEY) return null;

  for (let attempt = 0; attempt < 5; attempt++) {
    const suggestions = await suggest(query);
    const best = pickBestSuggestion(suggestions);
    if (best) {
      return {
        lat: parseFloat(best.data.geo_lat!),
        lon: parseFloat(best.data.geo_lon!),
      };
    }

    const next = trimQueryForRetry(query);
    if (!next || next === query) break;
    query = next;
  }

  return null;
}
