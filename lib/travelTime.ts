/**
 * Оценка времени в пути завод → адрес (минуты).
 * Используется API travel-time и автопересчётом при смене адреса заявки.
 *
 * Формула v3: кривизна 1.3, скорость 55 км/ч; самовывоз → 0.
 */
import { isPickupOrder, normalizeDeliveryAddress } from '@/lib/bryanskAddress';
import {
  extractCoordsFromAddress,
  geocodeAddressWithFallback,
  getRouteOriginCoords,
  prepareGeocodeQuery,
} from '@/lib/geocodeAddress';

/** Версия формулы — при росте сбрасывать кэш через force. */
export const TRAVEL_FORMULA_VERSION = 3;

const ROUTING_FACTOR = 1.3;
const AVG_SPEED_KMH = 55;
const MIN_TRAVEL_MIN = 10;
/** Ближе этого — считаем «на заводе» (самовывоз / точка БСУ). */
const PLANT_EPS_KM = 0.25;
/** Порог «у ворот завода» для GPS-шума в планировщике. */
export const GPS_NEAR_PLANT_KM = 0.8;
export const FALLBACK_TRAVEL_MIN = 30;

export type TravelCoords = { lat: number; lon: number };

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

/** Прямое расстояние между точками (км). */
export function haversineKmBetween(a: TravelCoords, b: TravelCoords): number {
  return haversineKm(a.lat, a.lon, b.lat, b.lon);
}

/**
 * Оценка минут дороги между двумя координатами (формула v3: ×1.3 / 55 км/ч).
 * Ближе plantEpsKm → 0; иначе не меньше MIN_TRAVEL_MIN.
 */
export function estimateRoadMinutesBetween(
  a: TravelCoords,
  b: TravelCoords,
  opts?: { plantEpsKm?: number; minTravelMin?: number },
): number {
  const plantEps = opts?.plantEpsKm ?? PLANT_EPS_KM;
  const minTravel = opts?.minTravelMin ?? MIN_TRAVEL_MIN;
  const straightKm = haversineKm(a.lat, a.lon, b.lat, b.lon);
  if (straightKm < plantEps) return 0;
  const roadKm = straightKm * ROUTING_FACTOR;
  const estimatedMin = Math.round((roadKm / AVG_SPEED_KMH) * 60);
  return Math.max(minTravel, estimatedMin);
}

/** GPS/точка у завода (с запасом на шум). */
export function isNearPlant(
  lat: number,
  lon: number,
  epsKm: number = GPS_NEAR_PLANT_KM,
): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  if (lat === 0 && lon === 0) return false;
  const plant = getRouteOriginCoords();
  return haversineKm(plant.lat, plant.lon, lat, lon) < epsKm;
}

/**
 * Подготовка адреса для геокода: normalize (ЖК/Ходаринка/самовывоз) + expand сокращений.
 */
export function prepareTravelGeocodeQuery(raw: string): string {
  if (extractCoordsFromAddress(raw)) return raw.trim();
  return prepareGeocodeQuery(normalizeDeliveryAddress(raw));
}

/** Считает дорогу по адресу (без записи в БД). */
export async function computeRoadMinutes(
  address: string | null | undefined,
): Promise<{ road_time_min: number; source: 'calculated' | 'fallback' }> {
  const raw = String(address || '').trim();
  if (!raw) {
    return { road_time_min: FALLBACK_TRAVEL_MIN, source: 'fallback' };
  }

  // Самовывоз — клиент на заводе, дороги нет (раньше получалось 10 мин → ложные задержки).
  if (isPickupOrder(raw)) {
    return { road_time_min: 0, source: 'calculated' };
  }

  const query = prepareTravelGeocodeQuery(raw);
  const coords =
    extractCoordsFromAddress(query) || (await geocodeAddressWithFallback(query));
  if (!coords) {
    return { road_time_min: FALLBACK_TRAVEL_MIN, source: 'fallback' };
  }

  const plant = getRouteOriginCoords();
  return {
    road_time_min: estimateRoadMinutesBetween(plant, coords, {
      plantEpsKm: PLANT_EPS_KM,
    }),
    source: 'calculated',
  };
}
