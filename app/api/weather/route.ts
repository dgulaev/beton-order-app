import { NextRequest, NextResponse } from 'next/server';
import {
  PLANT_WEATHER_LAT,
  PLANT_WEATHER_LON,
  PLANT_YANDEX_POGODA_URL,
  WEATHER_TIMEZONE,
} from '@/lib/weather/plant';
import { mergeWeatherPayloads, parseOpenMeteoForecast } from '@/lib/weather/parse';
import type { WeatherForecastPayload } from '@/lib/weather/types';
import { loadSystemSettingsServer } from '@/lib/systemSettingsServer';

const CACHE_TTL_MS = 45 * 60_000;
/** Archive (прошлые даты) почти не меняется — держим дольше на инстансе. */
const ARCHIVE_CACHE_TTL_MS = 7 * 24 * 60 * 60_000;
/** Forecast API: прошлые дни (0–92) + вперёд (до 16). */
const PAST_DAYS = 92;
const FORECAST_DAYS = 16;

const cache = new Map<string, { at: number; ttl: number; data: WeatherForecastPayload }>();

const DAILY_FORECAST = [
  'weather_code',
  'temperature_2m_max',
  'temperature_2m_min',
  'precipitation_sum',
  'precipitation_probability_max',
  'wind_speed_10m_max',
  'daylight_duration',
].join(',');

const HOURLY_FORECAST = [
  'temperature_2m',
  'weather_code',
  'precipitation_probability',
  'wind_speed_10m',
].join(',');

/** Archive не отдаёт precipitation_probability_* — без них. */
const DAILY_ARCHIVE = [
  'weather_code',
  'temperature_2m_max',
  'temperature_2m_min',
  'precipitation_sum',
  'wind_speed_10m_max',
  'daylight_duration',
].join(',');

const HOURLY_ARCHIVE = [
  'temperature_2m',
  'weather_code',
  'wind_speed_10m',
].join(',');

function ymdInTz(d = new Date(), timeZone = WEATHER_TIMEZONE): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function addDaysYmd(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

function isYmd(v: string | null): v is string {
  return !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

function getCached(key: string): WeatherForecastPayload | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at >= hit.ttl) {
    cache.delete(key);
    return null;
  }
  return hit.data;
}

function setCached(key: string, data: WeatherForecastPayload, ttl = CACHE_TTL_MS) {
  cache.set(key, { at: Date.now(), ttl, data });
}

async function fetchOpenMeteoForecast(
  lat: number,
  lon: number,
  label: string,
): Promise<WeatherForecastPayload> {
  const qs = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    timezone: WEATHER_TIMEZONE,
    forecast_days: String(FORECAST_DAYS),
    past_days: String(PAST_DAYS),
    daily: DAILY_FORECAST,
    hourly: HOURLY_FORECAST,
  });

  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${qs}`, {
    next: { revalidate: 2700 },
  });
  if (!res.ok) throw new Error(`Open-Meteo forecast HTTP ${res.status}`);

  const raw = await res.json();
  const parsed = parseOpenMeteoForecast(raw);
  return { ...parsed, locationLabel: label || parsed.locationLabel };
}

async function fetchOpenMeteoArchive(
  lat: number,
  lon: number,
  label: string,
  startDate: string,
  endDate: string,
): Promise<WeatherForecastPayload> {
  if (startDate > endDate) {
    return {
      locationLabel: label,
      yandexUrl: PLANT_YANDEX_POGODA_URL,
      fetchedAt: new Date().toISOString(),
      days: [],
    };
  }

  const qs = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    timezone: WEATHER_TIMEZONE,
    start_date: startDate,
    end_date: endDate,
    daily: DAILY_ARCHIVE,
    hourly: HOURLY_ARCHIVE,
  });

  const res = await fetch(`https://archive-api.open-meteo.com/v1/archive?${qs}`, {
    next: { revalidate: 86_400 },
  });
  if (!res.ok) throw new Error(`Open-Meteo archive HTTP ${res.status}`);

  const raw = await res.json();
  const parsed = parseOpenMeteoForecast(raw);
  return { ...parsed, locationLabel: label || parsed.locationLabel };
}

export async function GET(request: NextRequest) {
  try {
    const settings = await loadSystemSettingsServer();
    const lat = settings.plant.weatherLat || PLANT_WEATHER_LAT;
    const lon = settings.plant.weatherLon || PLANT_WEATHER_LON;
    const label = settings.plant.weatherLabel || 'Брянск, завод';
    const locKey = `${lat},${lon}`;

    const fromParam = request.nextUrl.searchParams.get('from');
    const toParam = request.nextUrl.searchParams.get('to');
    const from = isYmd(fromParam) ? fromParam : null;
    const to = isYmd(toParam) ? toParam : from;

    const today = ymdInTz();
    const forecastWindowStart = addDaysYmd(today, -PAST_DAYS);
    // Archive обычно запаздывает на ~2–5 дней — свежее прошлое берём из forecast.
    const archiveSafeEnd = addDaysYmd(today, -2);

    const forecastCacheKey = `forecast:${locKey}`;
    let forecast = getCached(forecastCacheKey);
    if (!forecast) {
      forecast = await fetchOpenMeteoForecast(lat, lon, label);
      setCached(forecastCacheKey, forecast);
    }

    let data = forecast;

    // Нужен archive, если запрошен день старше окна past_days.
    if (from && to && from < forecastWindowStart) {
      const archiveStart = from;
      const archiveEnd = to < archiveSafeEnd ? to : archiveSafeEnd;
      if (archiveStart <= archiveEnd) {
        const archiveCacheKey = `archive:${locKey}:${archiveStart}:${archiveEnd}`;
        let archive = getCached(archiveCacheKey);
        if (!archive) {
          archive = await fetchOpenMeteoArchive(
            lat,
            lon,
            label,
            archiveStart,
            archiveEnd,
          );
          setCached(archiveCacheKey, archive, ARCHIVE_CACHE_TTL_MS);
        }
        // Forecast поверх archive для пересечения дат.
        data = mergeWeatherPayloads(forecast, archive);
      }
    }

    const isArchiveHeavy = !!(from && to && from < forecastWindowStart);
    return NextResponse.json(data, {
      headers: {
        'Cache-Control': isArchiveHeavy
          ? 'public, s-maxage=86400, stale-while-revalidate=604800'
          : 'public, s-maxage=2700, stale-while-revalidate=600',
      },
    });
  } catch (err) {
    console.error('[weather]', err);
    const fallback = cache.values().next().value?.data;
    if (fallback) {
      return NextResponse.json(fallback, {
        headers: { 'Cache-Control': 'public, s-maxage=60' },
      });
    }
    return NextResponse.json(
      { error: 'Не удалось загрузить прогноз погоды' },
      { status: 502 },
    );
  }
}
