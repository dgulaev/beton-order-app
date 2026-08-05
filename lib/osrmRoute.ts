/**
 * Геометрия маршрута по дорогам через публичный OSRM (как в OrderRouteMap / routeGeometry).
 * Без 'use client' — можно звать с сервера (trip-tracks) и с клиента.
 */

import { getRouteOriginCoords, type Coords } from '@/lib/geocodeAddress';

const OSRM_TIMEOUT_MS = 8000;

/** [широта, долгота] — формат Leaflet */
export type OsrmRouteGeometry = [number, number][];

export async function fetchOsrmRouteGeometry(
  dest: Coords,
  origin?: Coords | null,
): Promise<OsrmRouteGeometry | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OSRM_TIMEOUT_MS);
  try {
    const o = origin || getRouteOriginCoords();
    const url =
      `https://router.project-osrm.org/route/v1/driving/` +
      `${o.lon},${o.lat};${dest.lon},${dest.lat}?overview=full&geometries=geojson`;
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;

    const data = await res.json();
    const coords: [number, number][] | undefined = data?.routes?.[0]?.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) return null;

    // OSRM: [lon, lat] → Leaflet: [lat, lon]
    return coords.map(([lon, lat]) => [lat, lon] as [number, number]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
