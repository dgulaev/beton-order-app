/**
 * Оценка времени в пути завод → адрес (минуты).
 * Используется API travel-time и автопересчётом при смене адреса заявки.
 *
 * Формула v2: кривизна 1.3, скорость 55 км/ч.
 */
import { normalizeDeliveryAddress } from '@/lib/bryanskAddress';
import {
  extractCoordsFromAddress,
  geocodeAddressWithFallback,
  getRouteOriginCoords,
} from '@/lib/geocodeAddress';

/** Версия формулы — при росте сбрасывать кэш через force. */
export const TRAVEL_FORMULA_VERSION = 2;

const ROUTING_FACTOR = 1.3;
const AVG_SPEED_KMH = 55;
const MIN_TRAVEL_MIN = 10;
export const FALLBACK_TRAVEL_MIN = 30;

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Подготовка адреса для DaData: регион + «район» вместо «р-н».
 * Без «Брянская область» запрос «д. Заречная, Комаричский р-н» часто даёт 0 подсказок.
 */
export function prepareTravelGeocodeQuery(raw: string): string {
  if (extractCoordsFromAddress(raw)) return raw.trim();
  let q = normalizeDeliveryAddress(raw);
  // DaData стабильнее на полных словах, чем на «д.» / «р-н».
  // Важно: \\b в JS плохо дружит с кириллицей — только явные границы.
  q = q.replace(/(^|[\s,./])р-?н\.?(?=$|[\s,.])/gi, '$1район');
  q = q.replace(/(^|[\s,])д\.\s*(?=[А-ЯЁ])/gi, '$1деревня ');
  q = q.replace(/(^|[\s,])п\.\s*(?=[А-ЯЁ])/gi, '$1посёлок ');
  q = q.replace(/(^|[\s,])с\.\s*(?=[А-ЯЁ])/gi, '$1село ');
  q = q.replace(/\s{2,}/g, ' ').replace(/\s+,/g, ',').trim();
  return q;
}

/** Считает дорогу по адресу (без записи в БД). */
export async function computeRoadMinutes(
  address: string | null | undefined,
): Promise<{ road_time_min: number; source: 'calculated' | 'fallback' }> {
  let road_time_min = FALLBACK_TRAVEL_MIN;
  let source: 'calculated' | 'fallback' = 'fallback';
  const raw = String(address || '').trim();
  if (!raw) return { road_time_min, source };

  const query = prepareTravelGeocodeQuery(raw);
  const coords =
    extractCoordsFromAddress(query) || (await geocodeAddressWithFallback(query));
  if (coords) {
    const plant = getRouteOriginCoords();
    const straightKm = haversineKm(plant.lat, plant.lon, coords.lat, coords.lon);
    const roadKm = straightKm * ROUTING_FACTOR;
    const estimatedMin = Math.round((roadKm / AVG_SPEED_KMH) * 60);
    road_time_min = Math.max(MIN_TRAVEL_MIN, estimatedMin);
    source = 'calculated';
  }
  return { road_time_min, source };
}
