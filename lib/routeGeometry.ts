'use client';
// lib/routeGeometry.ts
// Реальный маршрут по дорогам (не "воздушная" прямая) для превью-карты в
// модалках заявки — строится через бесплатный публичный демо-сервер OSRM
// (Open Source Routing Machine, router.project-osrm.org), без API-ключа.
//
// ⚠️ Это публичный демо-сервер проекта OSRM, а не наш собственный —
// официально он предназначен для лёгкого/умеренного использования, без
// гарантий SLA и без объявленного точного лимита запросов. Если он окажется
// перегружен, недоступен или временно заблокирует наши запросы — функция
// ниже просто вернёт null, и карта останется как раньше (только маркеры
// завода/адреса без линии маршрута), без ошибок в интерфейсе. Если объём
// использования вырастет — можно поднять свой сервер OSRM с картой
// Брянской области (данные занимают буквально десятки МБ) для маршрутов
// без каких-либо лимитов.

import { useEffect, useState } from 'react';
import { ROUTE_ORIGIN_COORDS, type Coords } from './yandexRoute';

const OSRM_TIMEOUT_MS = 6000;

/** [широта, долгота] — формат, который понимает Leaflet (L.Polyline). */
export type RouteGeometry = [number, number][];

const memoryCache = new Map<string, RouteGeometry | null>();
const inFlight = new Map<string, Promise<RouteGeometry | null>>();
const SESSION_CACHE_PREFIX = 'osrmRoute:';

function cacheKey(dest: Coords): string {
  return `${dest.lat.toFixed(5)},${dest.lon.toFixed(5)}`;
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

async function fetchRouteGeometry(dest: Coords): Promise<RouteGeometry | null> {
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${ROUTE_ORIGIN_COORDS.lon},${ROUTE_ORIGIN_COORDS.lat};${dest.lon},${dest.lat}?overview=full&geometries=geojson`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), OSRM_TIMEOUT_MS);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;

    const data = await res.json();
    const coords: [number, number][] | undefined = data?.routes?.[0]?.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) return null;

    // OSRM отдаёт [lon, lat] (GeoJSON), Leaflet ждёт [lat, lon].
    return coords.map(([lon, lat]) => [lat, lon] as [number, number]);
  } catch {
    // Таймаут, сеть, перегруженный/заблокировавший нас сервер — просто нет линии.
    return null;
  }
}

async function getRouteGeometryCached(dest: Coords): Promise<RouteGeometry | null> {
  const key = cacheKey(dest);
  if (memoryCache.has(key)) return memoryCache.get(key) ?? null;

  const fromSession = readSessionCache(key);
  if (fromSession !== undefined) {
    memoryCache.set(key, fromSession);
    return fromSession;
  }

  let promise = inFlight.get(key);
  if (!promise) {
    promise = fetchRouteGeometry(dest).finally(() => inFlight.delete(key));
    inFlight.set(key, promise);
  }

  const result = await promise;
  memoryCache.set(key, result);
  // Как и с геокодированием — неудачу в sessionStorage не сохраняем, чтобы
  // временный сбой OSRM не "залипал" на весь сеанс браузера.
  if (result) writeSessionCache(key, result);
  return result;
}

/**
 * Хук, отдающий геометрию маршрута завод → адрес доставки (массив точек для
 * L.Polyline). null — пока не загрузилось или если построить не удалось
 * (в этом случае превью-карта просто показывает маркеры без линии).
 */
export function useRouteGeometry(dest: Coords | null): RouteGeometry | null {
  const [geometry, setGeometry] = useState<RouteGeometry | null>(null);

  useEffect(() => {
    if (!dest) {
      setGeometry(null);
      return;
    }

    let cancelled = false;
    setGeometry(null);

    getRouteGeometryCached(dest).then((result) => {
      if (!cancelled) setGeometry(result);
    });

    return () => {
      cancelled = true;
    };
  }, [dest?.lat, dest?.lon]);

  return geometry;
}
