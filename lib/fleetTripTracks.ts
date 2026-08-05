import { getRouteOriginAddress, isPickupOrder } from '@/lib/bryanskAddress';
import {
  extractCoordsFromAddress,
  geocodeAddressWithFallback,
  getRouteOriginCoords,
} from '@/lib/geocodeAddress';
import { fetchOsrmRouteGeometry } from '@/lib/osrmRoute';
import { prepareTravelGeocodeQuery } from '@/lib/travelTime';
import { scoutFetchNavigationTrack } from '@/lib/integrations/scout';
import { mixerPlatesEqual } from '@/lib/plannerFactMatch';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export type FleetGpsPoint = {
  lat: number;
  lon: number;
  speedKmh?: number | null;
  recordedAt?: string;
};

export type FleetTripRoute = {
  tripId: number;
  orderId: number;
  color: string;
  label: string;
  clientName: string;
  address: string;
  status: string;
  volume: number;
  startedAt: string | null;
  endedAt: string | null;
  pointCount: number;
  /** Нет OSRM и мало GPS — прямая схема */
  approximate: boolean;
  /** Источник основной линии: osrm (по дорогам) / gps / straight */
  routeSource: 'osrm' | 'gps' | 'straight';
  /** Плановый маршрут завод → объект (OSRM), для сравнения с фактом */
  plannedPoints: FleetGpsPoint[];
  /** Фактический GPS за окно рейса (если есть) */
  actualPoints: FleetGpsPoint[];
  /** Основная линия для карты (плановый, иначе факт, иначе схема) */
  points: FleetGpsPoint[];
  destination: { lat: number; lon: number } | null;
};

/** Насыщенные цвета — читаются на светлой OSM «Схеме». */
const TRIP_COLORS = [
  '#2563EB',
  '#7C3AED',
  '#DB2777',
  '#D97706',
  '#059669',
  '#EA580C',
  '#1D4ED8',
  '#C026D3',
  '#16A34A',
  '#DC2626',
];

/** Не ждать СКАУТ вечно на serverless — иначе trip-tracks падает по maxDuration. */
const SCOUT_TRACK_BUDGET_MS = 12_000;
const OSRM_CONCURRENCY = 3;

function distDeg(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  return Math.hypot(a.lat - b.lat, a.lon - b.lon);
}

function dayBounds(day: string): { fromIso: string; toIso: string } {
  return {
    fromIso: `${day}T00:00:00+03:00`,
    toIso: `${day}T23:59:59+03:00`,
  };
}

function isValidGps(lat: number, lon: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lon) && !(lat === 0 && lon === 0);
}

function safeTimeMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : null;
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label}: timeout ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function loadGpsTrackForMixerDay(opts: {
  mixerId: number;
  scoutUnitId: number | null;
  day: string;
}): Promise<{ points: FleetGpsPoint[]; source: 'scout' | 'local' | 'none'; scoutError: string | null }> {
  const { fromIso, toIso } = dayBounds(opts.day);
  let scoutError: string | null = null;

  if (opts.scoutUnitId != null) {
    try {
      const scoutPts = await withTimeout(
        scoutFetchNavigationTrack({
          unitId: Number(opts.scoutUnitId),
          fromIso,
          toIso,
        }),
        SCOUT_TRACK_BUDGET_MS,
        'СКАУТ track',
      );
      const points = scoutPts
        .map((p) => ({
          lat: Number(p.lat),
          lon: Number(p.lon),
          speedKmh: p.speedKmh,
          recordedAt: p.recordedAt,
        }))
        .filter((p) => isValidGps(p.lat, p.lon));
      if (points.length) {
        return { points, source: 'scout', scoutError: null };
      }
    } catch (e) {
      scoutError = e instanceof Error ? e.message : String(e);
    }
  }

  const { data, error } = await supabaseAdmin
    .from('fleet_telemetry_points')
    .select('lat, lon, speed_kmh, recorded_at')
    .eq('mixer_id', opts.mixerId)
    .gte('recorded_at', fromIso)
    .lte('recorded_at', toIso)
    .order('recorded_at', { ascending: true })
    .limit(5000);

  if (error) {
    if (/fleet_telemetry_points/i.test(error.message)) {
      return { points: [], source: 'none', scoutError: scoutError || error.message };
    }
    throw error;
  }

  const points = (data ?? [])
    .map((row) => ({
      lat: Number(row.lat),
      lon: Number(row.lon),
      speedKmh: row.speed_kmh != null ? Number(row.speed_kmh) : null,
      recordedAt: String(row.recorded_at),
    }))
    .filter((p) => isValidGps(p.lat, p.lon));

  return {
    points,
    source: points.length ? 'local' : 'none',
    scoutError,
  };
}

type RawTrip = {
  id: number;
  orderId: number;
  status: string;
  volume: number;
  createdAt: string;
  loadingStartedAt: string | null;
  onSiteAt: string | null;
  unloadedAt: string | null;
  time: string | null;
  address: string;
  clientName: string;
  deliveryDate: string | null;
  deliveryTime: string | null;
};

async function loadTripsForMixerDay(mixerName: string, day: string): Promise<RawTrip[]> {
  // Фильтр по дню в SQL (orders!inner) — иначе limit 200 самых старых отрезает сегодня.
  const { data, error } = await supabaseAdmin
    .from('order_mixers')
    .select(
      `
      id,
      order_id,
      mixer_name,
      time,
      volume,
      status,
      created_at,
      loading_started_at,
      on_site_at,
      unloaded_at,
      orders!inner (
        id,
        delivery_date,
        delivery_time,
        address,
        organization_name,
        full_name
      )
      `,
    )
    .eq('orders.delivery_date', day)
    .order('created_at', { ascending: true })
    .limit(400);

  if (error) throw error;

  return (data ?? [])
    .filter((row: any) => mixerPlatesEqual(row.mixer_name, mixerName))
    .map((row: any) => ({
      id: Number(row.id),
      orderId: Number(row.order_id),
      status: String(row.status || 'Загрузка'),
      volume: Number(row.volume || 0),
      createdAt: String(row.created_at),
      loadingStartedAt: row.loading_started_at ? String(row.loading_started_at) : null,
      onSiteAt: row.on_site_at ? String(row.on_site_at) : null,
      unloadedAt: row.unloaded_at ? String(row.unloaded_at) : null,
      time: row.time != null ? String(row.time) : null,
      address: String(row.orders?.address || ''),
      clientName: String(row.orders?.organization_name || row.orders?.full_name || '—'),
      deliveryDate: row.orders?.delivery_date ? String(row.orders.delivery_date).slice(0, 10) : null,
      deliveryTime: row.orders?.delivery_time != null ? String(row.orders.delivery_time) : null,
    }));
}

/** Старт окна GPS: факт загрузки → плановое время рейса → created_at → полночь дня. */
function tripStartMs(trip: RawTrip, day: string): number {
  const loading = safeTimeMs(trip.loadingStartedAt);
  if (loading != null) return loading;

  if (trip.deliveryDate && trip.time) {
    const t = trip.time.length === 5 ? `${trip.time}:00` : trip.time;
    const planned = safeTimeMs(`${trip.deliveryDate}T${t}+03:00`);
    if (planned != null) return planned;
  }
  if (trip.deliveryDate && trip.deliveryTime) {
    const planned = safeTimeMs(`${trip.deliveryDate}T${trip.deliveryTime}+03:00`);
    if (planned != null) return planned;
  }

  const created = safeTimeMs(trip.createdAt);
  if (created != null) return created;

  return new Date(`${day}T00:00:00+03:00`).getTime();
}

function tripEndMs(trip: RawTrip, nextStart: number | null, dayEnd: number): number {
  const unloaded = safeTimeMs(trip.unloadedAt);
  if (unloaded != null) return unloaded;
  const onSite = safeTimeMs(trip.onSiteAt);
  if (onSite != null) return onSite + 45 * 60_000;
  if (nextStart != null) return nextStart - 60_000;
  return dayEnd;
}

function filterGpsInWindow(
  gps: FleetGpsPoint[],
  startMs: number,
  endMs: number,
): FleetGpsPoint[] {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return [];
  return gps.filter((p) => {
    if (!p.recordedAt) return false;
    const t = new Date(p.recordedAt).getTime();
    return Number.isFinite(t) && t >= startMs && t <= endMs;
  });
}

/** Как в /api/geocode и travel-time: normalize + DaData / координаты в тексте. */
async function geocodeTripAddress(
  address: string,
  cache: Map<string, { lat: number; lon: number } | null>,
): Promise<{ lat: number; lon: number } | null> {
  const raw = String(address || '').trim();
  if (!raw) return null;
  const key = raw.toLowerCase();
  if (cache.has(key)) return cache.get(key) ?? null;

  let coords: { lat: number; lon: number } | null = null;
  if (isPickupOrder(raw)) {
    coords = getRouteOriginCoords();
  } else {
    const query = prepareTravelGeocodeQuery(raw);
    coords = extractCoordsFromAddress(query) || (await geocodeAddressWithFallback(query));
  }
  cache.set(key, coords);
  return coords;
}

function thinGpsSlice(gpsSlice: FleetGpsPoint[]): FleetGpsPoint[] {
  const out: FleetGpsPoint[] = [];
  for (const p of gpsSlice) {
    if (!isValidGps(p.lat, p.lon)) continue;
    const last = out[out.length - 1];
    if (last && distDeg(last, p) < 0.00005) continue;
    out.push({ lat: p.lat, lon: p.lon, recordedAt: p.recordedAt, speedKmh: p.speedKmh });
  }
  return out;
}

async function buildRouteLayers(
  plant: { lat: number; lon: number },
  gpsSlice: FleetGpsPoint[],
  destination: { lat: number; lon: number } | null,
): Promise<{
  plannedPoints: FleetGpsPoint[];
  actualPoints: FleetGpsPoint[];
  points: FleetGpsPoint[];
  routeSource: 'osrm' | 'gps' | 'straight';
  approximate: boolean;
}> {
  const actualPoints = thinGpsSlice(gpsSlice);

  let plannedPoints: FleetGpsPoint[] = [];
  if (destination && isValidGps(destination.lat, destination.lon)) {
    const sameAsPlant = distDeg(plant, destination) < 0.0003;
    if (!sameAsPlant) {
      const osrm = await fetchOsrmRouteGeometry(destination, plant);
      if (osrm?.length) {
        plannedPoints = osrm
          .map(([lat, lon]) => ({ lat, lon }))
          .filter((p) => isValidGps(p.lat, p.lon));
      }
    }
  }

  if (plannedPoints.length >= 2) {
    return {
      plannedPoints,
      actualPoints,
      points: plannedPoints,
      routeSource: 'osrm',
      approximate: false,
    };
  }

  if (actualPoints.length >= 2) {
    // Не дописываем destination прямой — иначе «телепорт» в конце факта
    return {
      plannedPoints: [],
      actualPoints,
      points: actualPoints,
      routeSource: 'gps',
      approximate: false,
    };
  }

  if (
    destination &&
    isValidGps(destination.lat, destination.lon) &&
    distDeg(plant, destination) >= 0.0003
  ) {
    return {
      plannedPoints: [],
      actualPoints,
      points: [
        { lat: plant.lat, lon: plant.lon },
        { lat: destination.lat, lon: destination.lon },
      ],
      routeSource: 'straight',
      approximate: true,
    };
  }

  return {
    plannedPoints: [],
    actualPoints,
    points: actualPoints,
    routeSource: 'straight',
    approximate: true,
  };
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next;
      next += 1;
      results[i] = await fn(items[i]!, i);
    }
  }
  const n = Math.max(1, Math.min(concurrency, items.length || 1));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

/** Собрать маршруты рейсов за день: завод → GPS-сегмент → адрес заявки. */
export async function buildTripRoutesForMixerDay(opts: {
  mixerId: number;
  mixerNumber: string;
  scoutUnitId: number | null;
  day: string;
}): Promise<{
  plant: { lat: number; lon: number; address: string };
  gpsSource: 'scout' | 'local' | 'none';
  scoutError: string | null;
  gpsPointCount: number;
  routes: FleetTripRoute[];
}> {
  const plant = {
    ...getRouteOriginCoords(),
    address: getRouteOriginAddress(),
  };
  const { toIso } = dayBounds(opts.day);
  const dayEnd = new Date(toIso).getTime();

  const [gps, rawTrips] = await Promise.all([
    loadGpsTrackForMixerDay({
      mixerId: opts.mixerId,
      scoutUnitId: opts.scoutUnitId,
      day: opts.day,
    }),
    loadTripsForMixerDay(opts.mixerNumber, opts.day),
  ]);

  // Окна по фактическому старту, не по порядку created_at
  const trips = [...rawTrips].sort(
    (a, b) => tripStartMs(a, opts.day) - tripStartMs(b, opts.day),
  );

  const geocodeCache = new Map<string, { lat: number; lon: number } | null>();
  const starts = trips.map((t) => tripStartMs(t, opts.day));

  const routes = await mapPool(trips, OSRM_CONCURRENCY, async (trip, i) => {
    const startMs = starts[i]!;
    const nextStart = i + 1 < starts.length ? starts[i + 1]! : null;
    const endMs = Math.max(startMs + 5 * 60_000, tripEndMs(trip, nextStart, dayEnd));

    const dest =
      trip.address && !isPickupOrder(trip.address)
        ? await geocodeTripAddress(trip.address, geocodeCache)
        : isPickupOrder(trip.address)
          ? plant
          : null;

    // Самовывоз — только точка завода, без линии
    if (isPickupOrder(trip.address) || (dest && distDeg(plant, dest) < 0.0003)) {
      const color = TRIP_COLORS[i % TRIP_COLORS.length]!;
      const timeLabel = trip.time || trip.deliveryTime || '';
      return {
        tripId: trip.id,
        orderId: trip.orderId,
        color,
        label: `#${trip.orderId}${timeLabel ? ` · ${timeLabel}` : ''}`,
        clientName: trip.clientName,
        address: trip.address || '—',
        status: trip.status,
        volume: trip.volume,
        startedAt: Number.isFinite(startMs) ? new Date(startMs).toISOString() : null,
        endedAt: Number.isFinite(endMs) ? new Date(endMs).toISOString() : null,
        pointCount: 0,
        approximate: false,
        routeSource: 'straight' as const,
        plannedPoints: [],
        actualPoints: [],
        points: [],
        destination: dest,
      };
    }

    const gpsSlice = filterGpsInWindow(gps.points, startMs, endMs);
    const layers = await buildRouteLayers(plant, gpsSlice, dest);
    const color = TRIP_COLORS[i % TRIP_COLORS.length]!;
    const timeLabel = trip.time || trip.deliveryTime || '';

    return {
      tripId: trip.id,
      orderId: trip.orderId,
      color,
      label: `#${trip.orderId}${timeLabel ? ` · ${timeLabel}` : ''}`,
      clientName: trip.clientName,
      address: trip.address || '—',
      status: trip.status,
      volume: trip.volume,
      startedAt: Number.isFinite(startMs) ? new Date(startMs).toISOString() : null,
      endedAt: Number.isFinite(endMs) ? new Date(endMs).toISOString() : null,
      pointCount: layers.points.length,
      approximate: layers.approximate,
      routeSource: layers.routeSource,
      plannedPoints: layers.plannedPoints,
      actualPoints: layers.actualPoints,
      points: layers.points,
      destination: dest,
    };
  });

  return {
    plant,
    gpsSource: gps.source,
    scoutError: gps.scoutError,
    gpsPointCount: gps.points.length,
    routes,
  };
}

export { dayBounds };
