/** WMO Weather interpretation codes (WW) — как в Open-Meteo. */

export type WeatherKind =
  | 'clear'
  | 'partly'
  | 'cloudy'
  | 'fog'
  | 'drizzle'
  | 'rain'
  | 'snow'
  | 'thunder';

export function weatherKindFromCode(code: number): WeatherKind {
  if (code === 0) return 'clear';
  if (code === 1 || code === 2) return 'partly';
  if (code === 3) return 'cloudy';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 51 && code <= 57) return 'drizzle';
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 95) return 'thunder';
  return 'cloudy';
}

export function weatherLabelRu(code: number): string {
  const map: Record<number, string> = {
    0: 'Ясно',
    1: 'Преимущественно ясно',
    2: 'Малооблачно',
    3: 'Пасмурно',
    45: 'Туман',
    48: 'Изморозь',
    51: 'Морось',
    53: 'Морось',
    55: 'Сильная морось',
    56: 'Ледяная морось',
    57: 'Ледяная морось',
    61: 'Небольшой дождь',
    63: 'Дождь',
    65: 'Сильный дождь',
    66: 'Ледяной дождь',
    67: 'Ледяной дождь',
    71: 'Небольшой снег',
    73: 'Снег',
    75: 'Сильный снег',
    77: 'Снежные зёрна',
    80: 'Ливень',
    81: 'Ливень',
    82: 'Сильный ливень',
    85: 'Снегопад',
    86: 'Сильный снегопад',
    95: 'Гроза',
    96: 'Гроза с градом',
    99: 'Гроза с градом',
  };
  if (map[code]) return map[code];
  return weatherKindFromCode(code) === 'rain' ? 'Дождь' : 'Облачно';
}
