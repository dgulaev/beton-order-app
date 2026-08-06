/** Фаза 3 FMS — топливо, расходы, стоимость 1 км, норма vs факт. */

import { todayMoscowYmd } from '@/lib/fleetService';

export type FuelEntry = {
  id: number;
  mixer_id: number;
  filled_at: string;
  liters: number;
  amount_rub: number | null;
  odometer_km: number | null;
  fuel_type: string | null;
  receipt_path: string | null;
  receipt_url?: string;
  created_by: string | null;
  created_at: string;
  /** manual | scout | driver | benza */
  source?: string | null;
};

export type ExpenseCategory = 'wash' | 'tire' | 'parking' | 'toll' | 'other';

export const EXPENSE_CATEGORIES: { value: ExpenseCategory; label: string }[] = [
  { value: 'wash', label: 'Мойка' },
  { value: 'tire', label: 'Шины / диски' },
  { value: 'parking', label: 'Стоянка' },
  { value: 'toll', label: 'Платные дороги' },
  { value: 'other', label: 'Прочее' },
];

export function isExpenseCategory(v: unknown): v is ExpenseCategory {
  return EXPENSE_CATEGORIES.some((c) => c.value === v);
}

export function expenseCategoryLabel(v: string): string {
  return EXPENSE_CATEGORIES.find((c) => c.value === v)?.label ?? v;
}

export type FleetExpense = {
  id: number;
  mixer_id: number;
  expense_date: string;
  category: ExpenseCategory | string;
  amount_rub: number;
  description: string | null;
  receipt_path: string | null;
  receipt_url?: string;
  created_by: string | null;
  created_at: string;
};

export type FleetCostPeriod = {
  from: string;
  to: string;
  fuelRub: number;
  fuelLiters: number;
  serviceRub: number;
  expensesRub: number;
  totalRub: number;
  odometerStart: number | null;
  odometerEnd: number | null;
  odometerDelta: number | null;
  costPerKm: number | null;
  /** л/100км по заправкам между одометрами или по пробегу СКАУТ */
  litersPer100km: number | null;
  fuelNormLPer100km: number | null;
  fuelNormDeltaPct: number | null;
  /** Откуда взят пробег для л/100км и ₽/км */
  mileageSource?: 'odometer_readings' | 'scout_gps' | null;
};

/** Период по умолчанию — текущий календарный месяц (МСК). */
export function defaultCostPeriod(): { from: string; to: string } {
  const to = todayMoscowYmd();
  const [y, m] = to.split('-').map(Number);
  const from = `${y}-${String(m).padStart(2, '0')}-01`;
  return { from, to };
}

/** История заправок в карточке ТС — с 1 января текущего года (МСК). */
export function defaultFuelHistoryPeriod(): { from: string; to: string } {
  const to = todayMoscowYmd();
  const y = to.slice(0, 4);
  return { from: `${y}-01-01`, to };
}

/**
 * Cost per km и норма vs факт.
 * Пробег: max−min одометров на заправках/ТО; иначе periodMileageKm (СКАУТ GPS).
 */
export function computeFleetCostPeriod(input: {
  from: string;
  to: string;
  fuelRub: number;
  fuelLiters: number;
  serviceRub: number;
  expensesRub: number;
  odometerReadings: number[];
  fuelNormLPer100km?: number | null;
  /** Пробег за период из СКАУТ trackPeriodsMileage, км */
  periodMileageKm?: number | null;
}): FleetCostPeriod {
  const readings = input.odometerReadings
    .map(Number)
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b);

  const odometerStart = readings.length ? readings[0] : null;
  const odometerEnd = readings.length ? readings[readings.length - 1] : null;
  let odometerDelta =
    odometerStart != null && odometerEnd != null && odometerEnd > odometerStart
      ? odometerEnd - odometerStart
      : null;
  let mileageSource: FleetCostPeriod['mileageSource'] =
    odometerDelta != null ? 'odometer_readings' : null;

  const scoutKm =
    input.periodMileageKm != null && Number.isFinite(Number(input.periodMileageKm))
      ? Number(input.periodMileageKm)
      : null;

  // СКАУТ иногда отдаёт ~0–1 км при реальном пробеге — не считаем л/100км от мусора.
  // Порог: ≥50 км и расход не выше 200 л/100км (иначе пробег явно занижен).
  const scoutUsable =
    scoutKm != null &&
    scoutKm >= 50 &&
    (input.fuelLiters <= 0 || (input.fuelLiters / scoutKm) * 100 <= 200);

  if ((odometerDelta == null || odometerDelta <= 0) && scoutUsable) {
    odometerDelta = scoutKm;
    mileageSource = 'scout_gps';
  }

  const totalRub = input.fuelRub + input.serviceRub + input.expensesRub;
  const costPerKm =
    odometerDelta != null && odometerDelta > 0
      ? totalRub / odometerDelta
      : null;

  let litersPer100km =
    odometerDelta != null && odometerDelta > 0 && input.fuelLiters > 0
      ? (input.fuelLiters / odometerDelta) * 100
      : null;

  // Защита и для одометров: абсурдный расход = не показываем
  if (litersPer100km != null && litersPer100km > 200) {
    litersPer100km = null;
    if (mileageSource === 'scout_gps') {
      odometerDelta = null;
      mileageSource = null;
    }
  }

  const norm =
    input.fuelNormLPer100km != null && Number.isFinite(Number(input.fuelNormLPer100km))
      ? Number(input.fuelNormLPer100km)
      : null;

  const fuelNormDeltaPct =
    litersPer100km != null && norm != null && norm > 0
      ? ((litersPer100km - norm) / norm) * 100
      : null;

  return {
    from: input.from,
    to: input.to,
    fuelRub: input.fuelRub,
    fuelLiters: input.fuelLiters,
    serviceRub: input.serviceRub,
    expensesRub: input.expensesRub,
    totalRub,
    odometerStart,
    odometerEnd,
    odometerDelta,
    costPerKm,
    litersPer100km,
    fuelNormLPer100km: norm,
    fuelNormDeltaPct,
    mileageSource,
  };
}

export function normalizeFuelEntry(row: Record<string, unknown>): FuelEntry {
  return {
    id: Number(row.id),
    mixer_id: Number(row.mixer_id),
    filled_at: String(row.filled_at || ''),
    liters: Number(row.liters) || 0,
    amount_rub: row.amount_rub != null ? Number(row.amount_rub) : null,
    odometer_km: row.odometer_km != null ? Number(row.odometer_km) : null,
    fuel_type: row.fuel_type != null ? String(row.fuel_type) : null,
    receipt_path: row.receipt_path != null ? String(row.receipt_path) : null,
    created_by: row.created_by != null ? String(row.created_by) : null,
    created_at: String(row.created_at || ''),
    source: row.source != null ? String(row.source) : 'manual',
  };
}

export function normalizeExpense(row: Record<string, unknown>): FleetExpense {
  return {
    id: Number(row.id),
    mixer_id: Number(row.mixer_id),
    expense_date: String(row.expense_date || '').slice(0, 10),
    category: String(row.category || 'other'),
    amount_rub: Number(row.amount_rub) || 0,
    description: row.description != null ? String(row.description) : null,
    receipt_path: row.receipt_path != null ? String(row.receipt_path) : null,
    created_by: row.created_by != null ? String(row.created_by) : null,
    created_at: String(row.created_at || ''),
  };
}
