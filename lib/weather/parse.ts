import { weatherKindFromCode, weatherLabelRu } from './codes';
import type { WeatherDay, WeatherDayPart, WeatherForecastPayload, WeatherHour } from './types';
import { PLANT_WEATHER_LABEL, PLANT_YANDEX_POGODA_URL } from './plant';

type OpenMeteoResponse = {
  daily?: {
    time?: string[];
    weather_code?: number[];
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
    precipitation_sum?: number[];
    precipitation_probability_max?: number[];
    wind_speed_10m_max?: number[];
    daylight_duration?: number[];
  };
  hourly?: {
    time?: string[];
    temperature_2m?: (number | null)[];
    weather_code?: (number | null)[];
    precipitation_probability?: (number | null)[];
    wind_speed_10m?: (number | null)[];
  };
};

function avg(nums: number[]): number | null {
  if (!nums.length) return null;
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10;
}

function modeCode(codes: number[]): number {
  if (!codes.length) return 3;
  const freq = new Map<number, number>();
  for (const c of codes) freq.set(c, (freq.get(c) || 0) + 1);
  let best = codes[0];
  let bestN = 0;
  for (const [c, n] of freq) {
    if (n > bestN) {
      best = c;
      bestN = n;
    }
  }
  return best;
}

function buildParts(
  hours: Array<{
    hour: number;
    temp: number | null;
    code: number;
    precipProb: number | null;
    wind: number | null;
  }>,
): WeatherDayPart[] {
  const slots: { key: WeatherDayPart['key']; label: string; from: number; to: number }[] = [
    { key: 'morning', label: 'Утро', from: 6, to: 11 },
    { key: 'day', label: 'День', from: 12, to: 17 },
    { key: 'evening', label: 'Вечер', from: 18, to: 22 },
  ];

  return slots.map((slot) => {
    const slice = hours.filter((h) => h.hour >= slot.from && h.hour <= slot.to);
    const temps = slice.map((h) => h.temp).filter((t): t is number => t != null);
    const codes = slice.map((h) => h.code);
    const code = modeCode(codes);
    const precip = slice
      .map((h) => h.precipProb)
      .filter((p): p is number => p != null);
    const winds = slice.map((h) => h.wind).filter((w): w is number => w != null);
    return {
      key: slot.key,
      label: slot.label,
      tempAvg: avg(temps),
      weatherCode: code,
      kind: weatherKindFromCode(code),
      labelRu: weatherLabelRu(code),
      precipProb: precip.length ? Math.max(...precip) : null,
      wind: winds.length ? Math.round(Math.max(...winds) * 10) / 10 : null,
    };
  });
}

export function parseOpenMeteoForecast(raw: OpenMeteoResponse): WeatherForecastPayload {
  const dailyTimes = raw.daily?.time || [];
  const hourlyTimes = raw.hourly?.time || [];

  const hoursByDate = new Map<
    string,
    Array<{
      hour: number;
      temp: number | null;
      code: number;
      precipProb: number | null;
      wind: number | null;
      hhmm: string;
    }>
  >();

  for (let i = 0; i < hourlyTimes.length; i++) {
    const iso = hourlyTimes[i];
    const date = iso.slice(0, 10);
    const hhmm = iso.slice(11, 16);
    const hour = Number(hhmm.slice(0, 2));
    const list = hoursByDate.get(date) || [];
    list.push({
      hour,
      hhmm,
      temp: raw.hourly?.temperature_2m?.[i] ?? null,
      code: Number(raw.hourly?.weather_code?.[i] ?? 3),
      precipProb: raw.hourly?.precipitation_probability?.[i] ?? null,
      wind: raw.hourly?.wind_speed_10m?.[i] ?? null,
    });
    hoursByDate.set(date, list);
  }

  const days: WeatherDay[] = dailyTimes.map((date, i) => {
    const code = Number(raw.daily?.weather_code?.[i] ?? 3);
    const dayHours = hoursByDate.get(date) || [];
    const hours: WeatherHour[] = dayHours.map((h) => ({
      time: h.hhmm,
      temp: h.temp != null ? Math.round(h.temp) : null,
      weatherCode: h.code,
      kind: weatherKindFromCode(h.code),
      labelRu: weatherLabelRu(h.code),
      precipProb: h.precipProb,
      wind: h.wind != null ? Math.round(h.wind * 10) / 10 : null,
    }));

    return {
      date,
      weatherCode: code,
      kind: weatherKindFromCode(code),
      labelRu: weatherLabelRu(code),
      tempMin:
        raw.daily?.temperature_2m_min?.[i] != null
          ? Math.round(raw.daily.temperature_2m_min[i])
          : null,
      tempMax:
        raw.daily?.temperature_2m_max?.[i] != null
          ? Math.round(raw.daily.temperature_2m_max[i])
          : null,
      precipSum:
        raw.daily?.precipitation_sum?.[i] != null
          ? Math.round(raw.daily.precipitation_sum[i] * 10) / 10
          : null,
      precipProbMax:
        raw.daily?.precipitation_probability_max?.[i] != null
          ? Math.round(raw.daily.precipitation_probability_max[i])
          : null,
      windMax:
        raw.daily?.wind_speed_10m_max?.[i] != null
          ? Math.round(raw.daily.wind_speed_10m_max[i] * 10) / 10
          : null,
      daylightDurationSec:
        raw.daily?.daylight_duration?.[i] != null
          ? Math.round(raw.daily.daylight_duration[i])
          : null,
      parts: buildParts(dayHours),
      hours,
    };
  });

  return {
    locationLabel: PLANT_WEATHER_LABEL,
    yandexUrl: PLANT_YANDEX_POGODA_URL,
    fetchedAt: new Date().toISOString(),
    days,
  };
}
