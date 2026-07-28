import { NextResponse } from 'next/server';
import {
  PLANT_WEATHER_LAT,
  PLANT_WEATHER_LON,
  WEATHER_TIMEZONE,
} from '@/lib/weather/plant';
import { parseOpenMeteoForecast } from '@/lib/weather/parse';
import type { WeatherForecastPayload } from '@/lib/weather/types';

const CACHE_TTL_MS = 45 * 60_000;
let cache: { at: number; data: WeatherForecastPayload } | null = null;

async function fetchOpenMeteo(): Promise<WeatherForecastPayload> {
  const qs = new URLSearchParams({
    latitude: String(PLANT_WEATHER_LAT),
    longitude: String(PLANT_WEATHER_LON),
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
    // Next fetch cache + наш in-memory TTL
    next: { revalidate: 2700 },
  });

  if (!res.ok) {
    throw new Error(`Open-Meteo HTTP ${res.status}`);
  }

  const raw = await res.json();
  return parseOpenMeteoForecast(raw);
}

export async function GET() {
  try {
    const now = Date.now();
    if (cache && now - cache.at < CACHE_TTL_MS) {
      return NextResponse.json(cache.data, {
        headers: {
          'Cache-Control': 'public, s-maxage=2700, stale-while-revalidate=600',
        },
      });
    }

    const data = await fetchOpenMeteo();
    cache = { at: now, data };

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
