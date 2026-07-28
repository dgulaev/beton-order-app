import type { WeatherKind } from './codes';

export type WeatherDayPart = {
  key: 'morning' | 'day' | 'evening';
  label: string;
  tempAvg: number | null;
  weatherCode: number;
  kind: WeatherKind;
  labelRu: string;
  precipProb: number | null;
  wind: number | null;
};

export type WeatherHour = {
  time: string; // HH:MM
  temp: number | null;
  weatherCode: number;
  kind: WeatherKind;
  labelRu: string;
  precipProb: number | null;
  wind: number | null;
};

export type WeatherDay = {
  date: string; // YYYY-MM-DD
  weatherCode: number;
  kind: WeatherKind;
  labelRu: string;
  tempMin: number | null;
  tempMax: number | null;
  precipSum: number | null;
  precipProbMax: number | null;
  windMax: number | null;
  /** Продолжительность светового дня, секунды (Open-Meteo daylight_duration) */
  daylightDurationSec: number | null;
  parts: WeatherDayPart[];
  hours: WeatherHour[];
};

export type WeatherForecastPayload = {
  locationLabel: string;
  yandexUrl: string;
  fetchedAt: string;
  days: WeatherDay[];
};
