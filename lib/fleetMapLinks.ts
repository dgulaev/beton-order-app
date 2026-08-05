/** Ссылки на внешние карты по координатам ТС (без 'use client'). */

export function buildYandexPlaceUrl(
  lat: number,
  lon: number,
  label?: string | null,
  zoom = 16,
): string {
  const params = new URLSearchParams({
    pt: `${lon},${lat}`,
    z: String(zoom),
    l: 'map',
  });
  if (label?.trim()) {
    params.set('text', label.trim());
  }
  return `https://yandex.ru/maps/?${params.toString()}`;
}

export function buildGooglePlaceUrl(lat: number, lon: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;
}

export function buildTwoGisPlaceUrl(lat: number, lon: number): string {
  return `https://2gis.ru/bryansk/geo/${lon}%2C${lat}`;
}
