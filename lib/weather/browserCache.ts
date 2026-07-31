/**
 * Клиентский кэш погоды в localStorage.
 * Прошедшие дни почти не меняются — держим долго, чтобы не долбить
 * Open-Meteo archive при каждом клике по календарю.
 */

import type { WeatherDay, WeatherForecastPayload } from './types';

const STORAGE_KEY = 'cifra:weather-days:v1';
/** Окно «сегодня ± прогноз» — короткий TTL. */
const FORECAST_TTL_MS = 45 * 60_000;
/** Завершённые прошлые дни — длинный TTL. */
const PAST_DAY_TTL_MS = 30 * 24 * 60 * 60_000;
const MAX_DAYS = 400;

type DayEntry = {
  at: number;
  day: WeatherDay;
  /** true — день строго в прошлом на момент записи (можно держать дольше). */
  past: boolean;
};

type Store = {
  locationLabel?: string;
  yandexUrl?: string;
  days: Record<string, DayEntry>;
};

function todayKey(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function ttlFor(entry: DayEntry, today: string): number {
  // Если дата всё ещё в прошлом — длинный TTL; иначе короткий.
  if (entry.day.date < today) return PAST_DAY_TTL_MS;
  return FORECAST_TTL_MS;
}

function readStore(): Store {
  if (typeof window === 'undefined') return { days: {} };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { days: {} };
    const parsed = JSON.parse(raw) as Store;
    if (!parsed || typeof parsed !== 'object' || !parsed.days) return { days: {} };
    return parsed;
  } catch {
    return { days: {} };
  }
}

function writeStore(store: Store) {
  if (typeof window === 'undefined') return;
  try {
    const today = todayKey();
    const entries = Object.entries(store.days).filter(([, e]) => {
      if (!e?.day?.date) return false;
      return Date.now() - e.at < ttlFor(e, today);
    });
    // LRU по времени записи, если раздулось.
    entries.sort((a, b) => b[1].at - a[1].at);
    const trimmed = entries.slice(0, MAX_DAYS);
    const days: Record<string, DayEntry> = {};
    for (const [k, v] of trimmed) days[k] = v;
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        locationLabel: store.locationLabel,
        yandexUrl: store.yandexUrl,
        days,
      } satisfies Store),
    );
  } catch {
    // quota / private mode — молча пропускаем
  }
}

/** Достать один день из кэша (если не протух). */
export function getCachedWeatherDay(date: string): WeatherDay | null {
  const store = readStore();
  const entry = store.days[date];
  if (!entry?.day) return null;
  if (Date.now() - entry.at >= ttlFor(entry, todayKey())) return null;
  return entry.day;
}

/** Собрать payload из кэша по списку дат (пропуская протухшие). */
export function getCachedWeatherPayload(
  dates?: string[],
): WeatherForecastPayload | null {
  const store = readStore();
  const today = todayKey();
  const wanted = dates?.length ? new Set(dates) : null;
  const days: WeatherDay[] = [];
  for (const [date, entry] of Object.entries(store.days)) {
    if (wanted && !wanted.has(date)) continue;
    if (!entry?.day) continue;
    if (Date.now() - entry.at >= ttlFor(entry, today)) continue;
    days.push(entry.day);
  }
  if (!days.length) return null;
  days.sort((a, b) => a.date.localeCompare(b.date));
  return {
    locationLabel: store.locationLabel || 'Брянск, завод',
    yandexUrl: store.yandexUrl || 'https://yandex.ru/pogoda/bryansk',
    fetchedAt: new Date().toISOString(),
    days,
  };
}

/** Записать дни из ответа API в localStorage. */
export function putCachedWeatherPayload(payload: WeatherForecastPayload) {
  if (!payload?.days?.length) return;
  const store = readStore();
  const today = todayKey();
  if (payload.locationLabel) store.locationLabel = payload.locationLabel;
  if (payload.yandexUrl) store.yandexUrl = payload.yandexUrl;
  const now = Date.now();
  for (const day of payload.days) {
    if (!day?.date) continue;
    store.days[day.date] = {
      at: now,
      day,
      past: day.date < today,
    };
  }
  writeStore(store);
}
