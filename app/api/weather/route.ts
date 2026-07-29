import { NextResponse } from 'next/server';
import {
  PLANT_WEATHER_LAT,
  PLANT_WEATHER_LON,
  WEATHER_TIMEZONE,
} from '@/lib/weather/plant';
import { parseOpenMeteoForecast } from '@/lib/weather/parse';
import type { WeatherForecastPayload } from '@/lib/weather/types';
import { loadSystemSettingsServer } from '@/lib/systemSettingsServer';

const CACHE_TTL_MS = 45 * 60_000;
let cache: { at: number; key: string; data: WeatherForecastPayload } | null = null;

async function fetchOpenMeteo(lat: number, lon: number, label: string): Promise<WeatherForecastPayload> {
  const qs = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    timezone: WEATHER_TIMEZONE,
    forecast_days: '10',
    daily: [
      'weather_code',
      'temperature_2m_max',
      'temperature_2m_min',
      'precipitation_sum',
      'precipitation_probability_max',
      'wind_speed_10m_max',
      'daylight_duration',
    ].join(','),
    hourly: [
      'temperature_2m',
      'weather_code',
      'precipitation_probability',
      'wind_speed_10m',
    ].join(','),
  });

  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${qs}`, {
    next: { revalidate: 2700 },
  });

  if (!res.ok) {
    throw new Error(`Open-Meteo HTTP ${res.status}`);
  }

  const raw = await res.json();
  const parsed = parseOpenMeteoForecast(raw);
  return { ...parsed, locationLabel: label || parsed.locationLabel };
}

export async function GET() {
  try {
    const settings = await loadSystemSettingsServer();
    const lat = settings.plant.weatherLat || PLANT_WEATHER_LAT;
    const lon = settings.plant.weatherLon || PLANT_WEATHER_LON;
    const label = settings.plant.weatherLabel || 'Брянск, завод';
    const cacheKey = `${lat},${lon}`;

    const now = Date.now();
    if (cache && cache.key === cacheKey && now - cache.at < CACHE_TTL_MS) {
      return NextResponse.json(cache.data, {
        headers: {
          'Cache-Control': 'public, s-maxage=2700, stale-while-revalidate=600',
        },
      });
    }

    const data = await fetchOpenMeteo(lat, lon, label);
    cache = { at: now, key: cacheKey, data };

    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'public, s-maxage=2700, stale-while-revalidate=600',
      },
    });
  } catch (err) {
    console.error('[weather]', err);
    if (cache) {
      return NextResponse.json(cache.data, {
        headers: { 'Cache-Control': 'public, s-maxage=60' },
      });
    }
    return NextResponse.json(
      { error: 'Не удалось загрузить прогноз погоды' },
      { status: 502 },
    );
  }
}
