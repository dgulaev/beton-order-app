'use client';

import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  Sun,
} from 'lucide-react';
import type { WeatherKind } from '@/lib/weather/codes';

export const WEATHER_ICON_COLOR: Record<WeatherKind, string> = {
  clear: '#FBBF24',
  partly: '#FCD34D',
  cloudy: '#94A3B8',
  fog: '#CBD5E1',
  drizzle: '#38BDF8',
  rain: '#0EA5E9',
  snow: '#BAE6FD',
  thunder: '#A78BFA',
};

export default function WeatherIcon({
  kind,
  size = 22,
  strokeWidth = 2.2,
}: {
  kind: WeatherKind;
  size?: number;
  strokeWidth?: number;
}) {
  const color = WEATHER_ICON_COLOR[kind] || '#94A3B8';
  const props = {
    size,
    strokeWidth,
    color,
    stroke: color,
    absoluteStrokeWidth: false as const,
    style: { color, flexShrink: 0 },
  };

  let Icon = Cloud;
  switch (kind) {
    case 'clear':
      Icon = Sun;
      break;
    case 'partly':
      Icon = CloudSun;
      break;
    case 'fog':
      Icon = CloudFog;
      break;
    case 'drizzle':
      Icon = CloudDrizzle;
      break;
    case 'rain':
      Icon = CloudRain;
      break;
    case 'snow':
      Icon = CloudSnow;
      break;
    case 'thunder':
      Icon = CloudLightning;
      break;
    default:
      Icon = Cloud;
  }

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        color,
        flexShrink: 0,
        lineHeight: 0,
      }}
      aria-hidden
    >
      <Icon {...props} />
    </span>
  );
}
