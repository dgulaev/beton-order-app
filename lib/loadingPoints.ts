/** Справочник точек погрузки (Фаза 2). */

export type LoadingPointKind = 'concrete' | 'aggregate' | 'cement' | 'mixed';
export type LoadingPointOwnership = 'own' | 'partner';

export type LoadingPoint = {
  id: number;
  name: string;
  kind: LoadingPointKind;
  ownership: LoadingPointOwnership;
  address?: string | null;
  lat?: number | null;
  lon?: number | null;
  is_default?: boolean;
  active?: boolean;
  notes?: string | null;
  external_key?: string | null;
};

export const LOADING_POINT_KINDS: { key: LoadingPointKind; label: string }[] = [
  { key: 'concrete', label: 'Бетон' },
  { key: 'aggregate', label: 'Щебень / песок' },
  { key: 'cement', label: 'Цемент' },
  { key: 'mixed', label: 'Смешанная' },
];

export function loadingPointKindLabel(kind: string | null | undefined): string {
  return LOADING_POINT_KINDS.find((k) => k.key === kind)?.label || kind || '—';
}

export function loadingPointOwnershipLabel(v: string | null | undefined): string {
  if (v === 'partner') return 'Партнёрская';
  return 'Своя';
}

/** Координаты точки для маршрута; null если нет. */
export function loadingPointCoords(
  p: Pick<LoadingPoint, 'lat' | 'lon'> | null | undefined
): { lat: number; lon: number } | null {
  if (!p) return null;
  const lat = Number(p.lat);
  const lon = Number(p.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}
