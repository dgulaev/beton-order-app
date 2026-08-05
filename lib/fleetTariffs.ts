/**
 * Тарифы единиц техники (кроме миксеров — у них delivery_settings).
 * Хранятся в mixers.specs.
 * Этап 2 (Фаза 3 FMS): при статусе «Разгружен» итог пишется в order_mixers
 * (fleet_tariff_*) через lib/fleetTripTariff.ts.
 *
 * Денежные ставки — пара нал / безнал.
 * Старые ключи без суффикса (`hour_rate_rub` и т.п.) = нал (обратная совместимость).
 */

import type { SpecField, VehicleKind } from '@/lib/fleetCatalog';

export const TARIFF_SPEC_KEYS = [
  'hour_rate_rub',
  'hour_rate_noncash_rub',
  'min_shift_hours',
  'trip_rate_rub',
  'trip_rate_noncash_rub',
  'primer_mix_cost_rub',
  'primer_mix_cost_noncash_rub',
  'km_rate_rub',
  'km_rate_noncash_rub',
] as const;

export type TariffSpecKey = (typeof TARIFF_SPEC_KEYS)[number];

export const TARIFF_KEY_SET = new Set<string>(TARIFF_SPEC_KEYS);

export type PaymentKind = 'cash' | 'noncash';

export function formatRub(amount: number): string {
  return `${Math.round(amount).toLocaleString('ru-RU')} ₽`;
}

export function unitHasFleetTariffs(kind: VehicleKind | string | null | undefined): boolean {
  return Boolean(kind && kind !== 'mixer');
}

const FIELD: Record<TariffSpecKey, SpecField> = {
  hour_rate_rub: {
    key: 'hour_rate_rub',
    label: 'Стоимость часа (нал)',
    type: 'number',
    unit: '₽/ч',
    placeholder: '8000',
  },
  hour_rate_noncash_rub: {
    key: 'hour_rate_noncash_rub',
    label: 'Стоимость часа (безнал)',
    type: 'number',
    unit: '₽/ч',
    placeholder: '9500',
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
    label: 'Стоимость рейса (нал)',
    type: 'number',
    unit: '₽/рейс',
    placeholder: '12000',
  },
  trip_rate_noncash_rub: {
    key: 'trip_rate_noncash_rub',
    label: 'Стоимость рейса (безнал)',
    type: 'number',
    unit: '₽/рейс',
    placeholder: '14000',
  },
  primer_mix_cost_rub: {
    key: 'primer_mix_cost_rub',
    label: 'Пусковая смесь (нал)',
    type: 'number',
    unit: '₽',
    placeholder: '5000',
  },
  primer_mix_cost_noncash_rub: {
    key: 'primer_mix_cost_noncash_rub',
    label: 'Пусковая смесь (безнал)',
    type: 'number',
    unit: '₽',
    placeholder: '5500',
  },
  km_rate_rub: {
    key: 'km_rate_rub',
    label: 'Ставка за км (нал)',
    type: 'number',
    unit: '₽/км',
    placeholder: '80',
  },
  km_rate_noncash_rub: {
    key: 'km_rate_noncash_rub',
    label: 'Ставка за км (безнал)',
    type: 'number',
    unit: '₽/км',
    placeholder: '90',
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
    return fields(
      'trip_rate_rub',
      'trip_rate_noncash_rub',
      'hour_rate_rub',
      'hour_rate_noncash_rub',
      'min_shift_hours',
      'km_rate_rub',
      'km_rate_noncash_rub',
    );
  }
  if (kind === 'tractor_unit') {
    return fields('hour_rate_rub', 'hour_rate_noncash_rub', 'min_shift_hours');
  }
  if (kind === 'special') {
    const subtype = String(specs?.subtype || 'other');
    if (subtype === 'concrete_pump') {
      return fields(
        'hour_rate_rub',
        'hour_rate_noncash_rub',
        'min_shift_hours',
        'primer_mix_cost_rub',
        'primer_mix_cost_noncash_rub',
      );
    }
    return fields('hour_rate_rub', 'hour_rate_noncash_rub', 'min_shift_hours');
  }
  return [];
}

export type FleetTariffSide = {
  amount: number;
  detail: string;
};

export type FleetTariffTotal = {
  label: 'Смена от' | 'Рейс от';
  cash: FleetTariffSide | null;
  noncash: FleetTariffSide | null;
  /** Меньшая из заполненных сторон — для «от …» и старых вызовов */
  amount: number;
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

function shiftSide(rate: number, hours: number, primer: number): FleetTariffSide | null {
  if (!(rate > 0 && hours > 0)) return null;
  const amount = rate * hours + (primer > 0 ? primer : 0);
  const parts = [`${rate.toLocaleString('ru-RU')} ₽/ч × ${hours} ч`];
  if (primer > 0) parts.push(`смесь ${primer.toLocaleString('ru-RU')} ₽`);
  return { amount, detail: parts.join(' + ') };
}

function tripSide(
  trip: number,
  km: number,
  rate: number,
  hours: number,
): FleetTariffSide | null {
  if (!(trip > 0)) return null;
  const parts: string[] = [`${trip.toLocaleString('ru-RU')} ₽/рейс`];
  if (km > 0) parts.push(`${km.toLocaleString('ru-RU')} ₽/км`);
  if (rate > 0 && hours > 0) {
    parts.push(`${rate.toLocaleString('ru-RU')} ₽/ч × ${hours} ч`);
  }
  return { amount: trip, detail: parts.join(' · ') };
}

function packTotal(
  label: 'Смена от' | 'Рейс от',
  cash: FleetTariffSide | null,
  noncash: FleetTariffSide | null,
): FleetTariffTotal | null {
  if (!cash && !noncash) return null;
  const amounts = [cash?.amount, noncash?.amount].filter((n): n is number => n != null && n > 0);
  const amount = Math.min(...amounts);
  const detailParts: string[] = [];
  if (cash) detailParts.push(`нал ${cash.detail}`);
  if (noncash) detailParts.push(`безнал ${noncash.detail}`);
  return { label, cash, noncash, amount, detail: detailParts.join(' · ') };
}

/** Итог для карточки: смена / рейс, отдельно нал и безнал. */
export function unitShiftOrTripTotal(
  kind: VehicleKind | string | null | undefined,
  specs?: Record<string, any> | null,
): FleetTariffTotal | null {
  if (!unitHasFleetTariffs(kind)) return null;

  const hours = num(specs, 'min_shift_hours');
  const rateCash = num(specs, 'hour_rate_rub');
  const rateNoncash = num(specs, 'hour_rate_noncash_rub');
  const tripCash = num(specs, 'trip_rate_rub');
  const tripNoncash = num(specs, 'trip_rate_noncash_rub');
  const kmCash = num(specs, 'km_rate_rub');
  const kmNoncash = num(specs, 'km_rate_noncash_rub');
  const primerCash = isConcretePump(kind, specs) ? num(specs, 'primer_mix_cost_rub') : NaN;
  const primerNoncash = isConcretePump(kind, specs) ? num(specs, 'primer_mix_cost_noncash_rub') : NaN;

  // Bulk: приоритет рейса, иначе смена
  if (kind === 'dump_truck' || kind === 'tonar' || kind === 'cement_truck') {
    const cashTrip = tripSide(tripCash, kmCash, rateCash, hours);
    const noncashTrip = tripSide(tripNoncash, kmNoncash, rateNoncash, hours);
    if (cashTrip || noncashTrip) {
      return packTotal('Рейс от', cashTrip, noncashTrip);
    }
    return packTotal(
      'Смена от',
      shiftSide(rateCash, hours, 0),
      shiftSide(rateNoncash, hours, 0),
    );
  }

  return packTotal(
    'Смена от',
    shiftSide(rateCash, hours, primerCash > 0 ? primerCash : 0),
    shiftSide(rateNoncash, hours, primerNoncash > 0 ? primerNoncash : 0),
  );
}

const SHORT_LABEL: Partial<Record<TariffSpecKey, string>> = {
  hour_rate_rub: 'Час (нал)',
  hour_rate_noncash_rub: 'Час (безнал)',
  min_shift_hours: 'Мин. часов смены',
  trip_rate_rub: 'Рейс (нал)',
  trip_rate_noncash_rub: 'Рейс (безнал)',
  primer_mix_cost_rub: 'Смесь (нал)',
  primer_mix_cost_noncash_rub: 'Смесь (безнал)',
  km_rate_rub: 'Км (нал)',
  km_rate_noncash_rub: 'Км (безнал)',
};

/** Строки расшифровки для тултипа по сумме тарифа. */
export function tariffBreakdownLines(
  kind: VehicleKind | string | null | undefined,
  specs?: Record<string, any> | null,
): { label: string; value: string }[] {
  const lines: { label: string; value: string }[] = [];
  for (const f of tariffFieldsForUnit(kind, specs)) {
    const n = num(specs, f.key);
    if (!(n > 0)) continue;
    const shortLabel = SHORT_LABEL[f.key as TariffSpecKey] || f.label;
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

/** Совместимость со старым хелпером бетононасоса (нал, иначе безнал). */
export function concretePumpShiftTotal(specs: Record<string, any> | null | undefined): number | null {
  if (!specs || String(specs.subtype) !== 'concrete_pump') return null;
  const t = unitShiftOrTripTotal('special', specs);
  return t?.cash?.amount ?? t?.noncash?.amount ?? null;
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
    // null — явное удаление ключа при мерже паспорта (норма расхода и т.п.)
    if (v === null) continue;
    if (v === '' || v === undefined) continue;
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
    delete tariffs.primer_mix_cost_noncash_rub;
  }
  return sanitizeFleetSpecs('special', { subtype: newSubtype, ...tariffs });
}
