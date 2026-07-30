/**
 * Тарифы единиц техники (кроме миксеров — у них delivery_settings).
 * Хранятся в mixers.specs; расчёт в рейсах/отгрузках — этап 2.
 */

import type { SpecField, VehicleKind } from '@/lib/fleetCatalog';

export const TARIFF_SPEC_KEYS = [
  'hour_rate_rub',
  'min_shift_hours',
  'trip_rate_rub',
  'primer_mix_cost_rub',
  'km_rate_rub',
] as const;

export type TariffSpecKey = (typeof TARIFF_SPEC_KEYS)[number];

export const TARIFF_KEY_SET = new Set<string>(TARIFF_SPEC_KEYS);

export function formatRub(amount: number): string {
  return `${Math.round(amount).toLocaleString('ru-RU')} ₽`;
}

export function unitHasFleetTariffs(kind: VehicleKind | string | null | undefined): boolean {
  return Boolean(kind && kind !== 'mixer');
}

const FIELD: Record<TariffSpecKey, SpecField> = {
  hour_rate_rub: {
    key: 'hour_rate_rub',
    label: 'Стоимость часа работы',
    type: 'number',
    unit: '₽/ч',
    placeholder: '8000',
  },
  min_shift_hours: {
    key: 'min_shift_hours',
    label: 'Минимальное количество часов смены',
    type: 'number',
    unit: 'ч',
    placeholder: '7',
  },
  trip_rate_rub: {
    key: 'trip_rate_rub',
    label: 'Стоимость рейса',
    type: 'number',
    unit: '₽/рейс',
    placeholder: '12000',
  },
  primer_mix_cost_rub: {
    key: 'primer_mix_cost_rub',
    label: 'Стоимость пусковой смеси',
    type: 'number',
    unit: '₽',
    placeholder: '5000',
  },
  km_rate_rub: {
    key: 'km_rate_rub',
    label: 'Ставка за км',
    type: 'number',
    unit: '₽/км',
    placeholder: '80',
  },
};

function fields(...keys: TariffSpecKey[]): SpecField[] {
  return keys.map((k) => FIELD[k]);
}

/** Умные тарифные поля для вида / подтипа спецтехники. */
export function tariffFieldsForUnit(
  kind: VehicleKind | string | null | undefined,
  specs?: Record<string, any> | null,
): SpecField[] {
  if (!unitHasFleetTariffs(kind)) return [];

  if (kind === 'dump_truck' || kind === 'tonar' || kind === 'cement_truck') {
    return fields('trip_rate_rub', 'hour_rate_rub', 'min_shift_hours', 'km_rate_rub');
  }
  if (kind === 'tractor_unit') {
    return fields('hour_rate_rub', 'min_shift_hours');
  }
  if (kind === 'special') {
    const subtype = String(specs?.subtype || 'other');
    if (subtype === 'concrete_pump') {
      return fields('hour_rate_rub', 'min_shift_hours', 'primer_mix_cost_rub');
    }
    return fields('hour_rate_rub', 'min_shift_hours');
  }
  return [];
}

export type FleetTariffTotal = {
  amount: number;
  /** Короткий ярлык для карточки */
  label: 'Смена от' | 'Рейс от';
  /** Расшифровка: «8000 ₽/ч × 7 ч + смесь …» */
  detail: string;
};

function num(specs: Record<string, any> | null | undefined, key: string): number {
  const n = Number(specs?.[key]);
  return Number.isFinite(n) ? n : NaN;
}

function isConcretePump(
  kind: VehicleKind | string | null | undefined,
  specs?: Record<string, any> | null,
): boolean {
  return kind === 'special' && String(specs?.subtype || '') === 'concrete_pump';
}

/** Итог для карточки: смена (час×часы[+смесь]) или рейс. */
export function unitShiftOrTripTotal(
  kind: VehicleKind | string | null | undefined,
  specs?: Record<string, any> | null,
): FleetTariffTotal | null {
  if (!unitHasFleetTariffs(kind)) return null;

  const rate = num(specs, 'hour_rate_rub');
  const hours = num(specs, 'min_shift_hours');
  const primer = num(specs, 'primer_mix_cost_rub');
  const trip = num(specs, 'trip_rate_rub');
  const primerApplies = isConcretePump(kind, specs) && primer > 0;

  const shiftOk = rate > 0 && hours > 0;
  const shiftAmount = shiftOk ? rate * hours + (primerApplies ? primer : 0) : null;

  // Bulk: приоритет рейса, иначе смена
  if (kind === 'dump_truck' || kind === 'tonar' || kind === 'cement_truck') {
    if (trip > 0) {
      const parts: string[] = [`${trip.toLocaleString('ru-RU')} ₽/рейс`];
      const km = num(specs, 'km_rate_rub');
      if (km > 0) parts.push(`${km.toLocaleString('ru-RU')} ₽/км`);
      if (shiftOk) parts.push(`${rate.toLocaleString('ru-RU')} ₽/ч × ${hours} ч`);
      return { amount: trip, label: 'Рейс от', detail: parts.join(' · ') };
    }
    if (shiftAmount != null) {
      return {
        amount: shiftAmount,
        label: 'Смена от',
        detail: `${rate.toLocaleString('ru-RU')} ₽/ч × ${hours} ч`,
      };
    }
    return null;
  }

  if (shiftAmount != null) {
    const parts = [`${rate.toLocaleString('ru-RU')} ₽/ч × ${hours} ч`];
    if (primerApplies) {
      parts.push(`смесь ${primer.toLocaleString('ru-RU')} ₽`);
    }
    return { amount: shiftAmount, label: 'Смена от', detail: parts.join(' + ') };
  }

  return null;
}

/** Строки расшифровки для тултипа по сумме тарифа. */
export function tariffBreakdownLines(
  kind: VehicleKind | string | null | undefined,
  specs?: Record<string, any> | null,
): { label: string; value: string }[] {
  const lines: { label: string; value: string }[] = [];
  for (const f of tariffFieldsForUnit(kind, specs)) {
    const n = num(specs, f.key);
    if (!(n > 0)) continue;
    const shortLabel =
      f.key === 'hour_rate_rub'
        ? 'Стоимость часа'
        : f.key === 'min_shift_hours'
          ? 'Мин. часов смены'
          : f.key === 'trip_rate_rub'
            ? 'Стоимость рейса'
            : f.key === 'primer_mix_cost_rub'
              ? 'Пусковая смесь'
              : f.key === 'km_rate_rub'
                ? 'Ставка за км'
                : f.label;
    const value =
      f.key === 'min_shift_hours'
        ? `${n} ч`
        : f.unit
          ? `${Math.round(n).toLocaleString('ru-RU')} ${f.unit}`
          : Math.round(n).toLocaleString('ru-RU');
    lines.push({ label: shortLabel, value });
  }
  return lines;
}

/** Совместимость со старым хелпером бетононасоса. */
export function concretePumpShiftTotal(specs: Record<string, any> | null | undefined): number | null {
  if (!specs || String(specs.subtype) !== 'concrete_pump') return null;
  return unitShiftOrTripTotal('special', specs)?.amount ?? null;
}

/** Вырезать тарифные ключи из specs (для merge при сохранении только тарифа). */
export function pickTariffSpecs(specs: Record<string, any> | null | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  if (!specs || typeof specs !== 'object') return out;
  for (const key of TARIFF_SPEC_KEYS) {
    if (specs[key] === undefined || specs[key] === null || specs[key] === '') continue;
    const n = Number(specs[key]);
    if (Number.isFinite(n)) out[key] = n;
  }
  return out;
}

/** Слить тарифные поля в существующие specs, не трогая физические. */
export function mergeTariffIntoSpecs(
  existing: Record<string, any> | null | undefined,
  tariffPatch: Record<string, any> | null | undefined,
): Record<string, any> {
  const base = existing && typeof existing === 'object' ? { ...existing } : {};
  for (const key of TARIFF_SPEC_KEYS) {
    if (!tariffPatch || !(key in tariffPatch)) continue;
    const raw = tariffPatch[key];
    if (raw === '' || raw === null || raw === undefined) {
      delete base[key];
      continue;
    }
    const n = Number(raw);
    if (Number.isFinite(n)) base[key] = n;
  }
  return base;
}

/** Убрать пустые/NaN и тарифные ключи, не относящиеся к виду/подтипу. */
export function sanitizeFleetSpecs(
  kind: VehicleKind | string | null | undefined,
  specs: Record<string, any> | null | undefined,
): Record<string, any> {
  const out: Record<string, any> = {};
  if (!specs || typeof specs !== 'object') return out;
  for (const [k, v] of Object.entries(specs)) {
    if (v === '' || v === undefined || v === null) continue;
    if (typeof v === 'number' && !Number.isFinite(v)) continue;
    out[k] = v;
  }
  const allowed = new Set(tariffFieldsForUnit(kind, out).map((f) => f.key));
  for (const key of TARIFF_SPEC_KEYS) {
    if (!allowed.has(key)) delete out[key];
  }
  return out;
}

/**
 * Смена подтипа спецтехники: сбрасываем физику, сохраняем применимые тарифы.
 * Раньше `{ subtype }` затирал hour_rate / смесь.
 */
export function specsAfterSpecialSubtypeChange(
  prevSpecs: Record<string, any> | null | undefined,
  newSubtype: string,
): Record<string, any> {
  const tariffs = pickTariffSpecs(prevSpecs);
  if (newSubtype !== 'concrete_pump') {
    delete tariffs.primer_mix_cost_rub;
  }
  return sanitizeFleetSpecs('special', { subtype: newSubtype, ...tariffs });
}
