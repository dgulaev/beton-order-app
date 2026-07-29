/**
 * Серверное геокодирование адреса (DaData) + чистые geo-хелперы без 'use client'.
 * (Не импортировать из lib/yandexRoute.ts на сервере — там 'use client'.)
 */

const DADATA_URL = 'https://suggestions.dadata.ru/suggestions/api/4_1/rs/suggest/address';

export type GeocodeCoords = { lat: number; lon: number };
export type Coords = GeocodeCoords;

/** Координаты своего БСУ (Брянск, Орловский тупик, 6). */
export const ROUTE_ORIGIN_COORDS: Coords = { lat: 53.25347, lon: 34.416444 };

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

type DadataSuggestion = { data: { geo_lat: string | null; geo_lon: string | null } };

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

/**
 * Геокодирует адрес с упрощением хвоста (дом → улица → город), если точного
 * совпадения нет — как в /api/geocode.
 */
export async function geocodeAddressWithFallback(rawQuery: string): Promise<GeocodeCoords | null> {
  let query = String(rawQuery || '').trim();
  if (!query || !process.env.DADATA_API_KEY) return null;

  for (let attempt = 0; attempt < 4; attempt++) {
    const suggestions = await suggest(query);
    const withCoords = suggestions.find((s) => s.data.geo_lat && s.data.geo_lon);
    if (withCoords) {
      return {
        lat: parseFloat(withCoords.data.geo_lat!),
        lon: parseFloat(withCoords.data.geo_lon!),
      };
    }

    const parts = query.split(',').map((p) => p.trim()).filter(Boolean);
    if (parts.length <= 1) break;
    parts.pop();
    query = parts.join(', ');
  }

  return null;
}
