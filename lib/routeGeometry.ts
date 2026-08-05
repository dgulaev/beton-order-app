'use client';
// lib/routeGeometry.ts
// Реальный маршрут по дорогам (не "воздушная" прямая) для превью-карты в
// модалках заявки — строится через бесплатный публичный демо-сервер OSRM
// (см. lib/osrmRoute.ts).

import { useEffect, useState } from 'react';
import { getRouteOriginCoords, type Coords } from './geocodeAddress';
import { fetchOsrmRouteGeometry, type OsrmRouteGeometry } from './osrmRoute';

/** [широта, долгота] — формат, который понимает Leaflet (L.Polyline). */
export type RouteGeometry = OsrmRouteGeometry;

const memoryCache = new Map<string, RouteGeometry | null>();
const inFlight = new Map<string, Promise<RouteGeometry | null>>();
const SESSION_CACHE_PREFIX = 'osrmRoute:';

function cacheKey(dest: Coords, origin?: Coords | null): string {
  const o = origin || getRouteOriginCoords();
  return `${o.lat.toFixed(5)},${o.lon.toFixed(5)}>${dest.lat.toFixed(5)},${dest.lon.toFixed(5)}`;
}

function readSessionCache(key: string): RouteGeometry | null | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const raw = window.sessionStorage.getItem(SESSION_CACHE_PREFIX + key);
    if (raw === null) return undefined;
    return JSON.parse(raw) as RouteGeometry | null;
  } catch {
    return undefined;
  }
}

function writeSessionCache(key: string, value: RouteGeometry) {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(SESSION_CACHE_PREFIX + key, JSON.stringify(value));
  } catch {
    // sessionStorage может быть недоступен (приватный режим и т.п.) — не критично.
  }
}

async function getRouteGeometryCached(dest: Coords, origin?: Coords | null): Promise<RouteGeometry | null> {
  const key = cacheKey(dest, origin);
  if (memoryCache.has(key)) return memoryCache.get(key) ?? null;

  const fromSession = readSessionCache(key);
  if (fromSession !== undefined) {
    memoryCache.set(key, fromSession);
    return fromSession;
  }

  let promise = inFlight.get(key);
  if (!promise) {
    promise = fetchOsrmRouteGeometry(dest, origin).finally(() => inFlight.delete(key));
    inFlight.set(key, promise);
  }

  const result = await promise;
  // Неудачу не кэшируем навсегда — временный сбой OSRM не должен «залипать».
  if (result) {
    memoryCache.set(key, result);
    writeSessionCache(key, result);
  } else {
    memoryCache.delete(key);
  }
  return result;
}

/**
 * Хук, отдающий геометрию маршрута точка погрузки → адрес доставки.
 * origin — координаты точки погрузки (Фаза 5); по умолчанию свой БСУ.
 */
export function useRouteGeometry(dest: Coords | null, origin?: Coords | null): RouteGeometry | null {
  const [geometry, setGeometry] = useState<RouteGeometry | null>(null);

  useEffect(() => {
    if (!dest) {
      setGeometry(null);
      return;
    }

    let cancelled = false;
    setGeometry(null);

    getRouteGeometryCached(dest, origin).then((result) => {
      if (!cancelled) setGeometry(result);
    });

    return () => {
      cancelled = true;
    };
  }, [dest?.lat, dest?.lon, origin?.lat, origin?.lon]);

  return geometry;
}
