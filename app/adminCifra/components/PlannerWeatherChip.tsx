'use client';

import { useEffect, useState } from 'react';
import WeatherIcon from './WeatherIcon';
import {
  getCachedWeatherDay,
  getCachedWeatherPayload,
  putCachedWeatherPayload,
} from '@/lib/weather/browserCache';
import type { WeatherDay, WeatherForecastPayload } from '@/lib/weather/types';
import { normalizePlanDateKey } from '@/lib/dailyLogisticsPlan';

type Props = {
  dateKey: string;
  uiScale?: number;
};

/**
 * Компактная погода дня для шапки интеллекта (Фаза 4).
 * Берёт кэш дашборда; при промахе — archive/forecast API.
 */
export default function PlannerWeatherChip({ dateKey, uiScale = 1 }: Props) {
  const apiDate = normalizePlanDateKey(dateKey) || dateKey;
  const [day, setDay] = useState<WeatherDay | null>(() =>
    getCachedWeatherDay(apiDate),
  );

  useEffect(() => {
    let cancelled = false;
    const cached = getCachedWeatherDay(apiDate);
    if (cached) {
      setDay(cached);
      return;
    }
    (async () => {
      try {
        const res = await fetch(
          `/api/weather?from=${encodeURIComponent(apiDate)}&to=${encodeURIComponent(apiDate)}`,
          { cache: 'no-store' },
        );
        if (!res.ok) {
          const base = await fetch('/api/weather', { cache: 'no-store' });
          if (!base.ok || cancelled) return;
          const data = (await base.json()) as WeatherForecastPayload;
          putCachedWeatherPayload(data);
          if (!cancelled) setDay(getCachedWeatherDay(apiDate));
          return;
        }
        const data = (await res.json()) as WeatherForecastPayload;
        const prev = getCachedWeatherPayload();
        putCachedWeatherPayload(
          prev
            ? {
                ...data,
                days: [
                  ...prev.days.filter((d) => d.date !== apiDate),
                  ...(data.days || []),
                ],
              }
            : data,
        );
        if (!cancelled) {
          setDay(
            data.days?.find((d) => d.date === apiDate) ||
              getCachedWeatherDay(apiDate),
          );
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiDate]);

  if (!day) return null;

  const tMin = day.tempMin != null ? Math.round(day.tempMin) : null;
  const tMax = day.tempMax != null ? Math.round(day.tempMax) : null;
  const precip =
    day.precipProbMax != null ? Math.round(day.precipProbMax) : null;

  return (
    <span
      title={day.labelRu || 'Погода дня'}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: `${Math.round(5 * uiScale)}px ${Math.round(10 * uiScale)}px`,
        borderRadius: 999,
        border: '1px solid rgba(148,163,184,0.35)',
        background: 'rgba(30,41,59,0.65)',
        color: '#E2E8F0',
        fontSize: Math.round(12 * uiScale),
        fontWeight: 600,
        whiteSpace: 'nowrap',
        marginLeft: 'auto',
      }}
    >
      <WeatherIcon kind={day.kind} size={Math.round(16 * uiScale)} />
      <span>
        {tMin != null && tMax != null
          ? `${tMin}…${tMax}°`
          : tMax != null
            ? `${tMax}°`
            : '—'}
      </span>
      {precip != null && precip > 0 ? (
        <span style={{ color: '#7DD3FC', fontWeight: 500 }}>{precip}%</span>
      ) : null}
    </span>
  );
}
