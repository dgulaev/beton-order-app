/**
 * Привод смесителя на бочке миксера.
 *
 * — pto: вал отбора мощности от основного двигателя (большинство парка)
 * — separate_engine: свой двигатель на бочке (у нас: 332, 021)
 */

import { normalizePlate } from '@/lib/fleetLifecycle';

export type DrumDriveType = 'pto' | 'separate_engine';

export const DRUM_DRIVE_OPTIONS: { value: DrumDriveType; label: string; hint: string }[] = [
  {
    value: 'pto',
    label: 'ВОМ (от основного двигателя)',
    hint: 'Бочка крутится, когда включён вал отбора мощности. Моточасы бочки ≤ моточасам шасси.',
  },
  {
    value: 'separate_engine',
    label: 'Отдельный двигатель на бочке',
    hint: 'Свой ДВС смесителя, независимо от двигателя шасси. Моточасы бочки считаются отдельно.',
  },
];

export function isDrumDriveType(v: unknown): v is DrumDriveType {
  return v === 'pto' || v === 'separate_engine';
}

/** Известные миксеры с отдельным двигателем бочки (нормализованный госномер). */
const SEPARATE_ENGINE_PLATES = new Set(
  ['К332КК32', 'О021УХ32'].map((p) => normalizePlate(p)),
);

export function inferDrumDriveTypeFromPlate(number: string | null | undefined): DrumDriveType | null {
  const key = normalizePlate(number || '');
  if (!key) return null;
  return SEPARATE_ENGINE_PLATES.has(key) ? 'separate_engine' : null;
}

/**
 * Тип привода бочки: явный из specs → эвристика по номеру → pto по умолчанию.
 */
export function resolveDrumDriveType(
  number: string | null | undefined,
  specs: Record<string, unknown> | null | undefined,
): DrumDriveType {
  const raw = specs?.drum_drive_type;
  if (isDrumDriveType(raw)) return raw;
  return inferDrumDriveTypeFromPlate(number) ?? 'pto';
}

export function drumHoursLabel(drive: DrumDriveType): string {
  return drive === 'separate_engine'
    ? 'Моточасы двигателя бочки'
    : 'Моточасы бочки (ВОМ)';
}
