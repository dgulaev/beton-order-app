/** Клиент-безопасные типы и хелперы аналитики парка (без supabaseAdmin). */

export type FleetAnalyticsFilters = {
  from?: string | null;
  to?: string | null;
  vehicleKind?: string | null;
};

/**
 * Считаем стоимость владения:
 * — все свои;
 * — техника «в аренде» в парке (бочка, самосвал и т.п.), кроме наёмных миксеров.
 * Наёмные миксеры (подённые) и прочий подряд без учёта владения — не считаем и не показываем в таблице.
 */
export function tracksOwnershipCost(input: {
  type?: string | null;
  vehicleKind?: string | null;
}): boolean {
  const type = String(input.type || 'own').toLowerCase();
  if (type === 'own') return true;
  if (type !== 'rented') return false;
  const kind = String(input.vehicleKind || 'mixer');
  return kind !== 'mixer';
}

export function ownershipTypeLabel(type?: string | null): string {
  return String(type || 'own').toLowerCase() === 'own' ? 'свой' : 'в аренде';
}

export type FleetAnalyticsUnitRow = {
  mixerId: number;
  number: string;
  model: string | null;
  vehicleKind: string;
  type: 'own' | 'rented' | string;
  lifecycleStatus: string | null;
  fuelRub: number;
  fuelLiters: number;
  serviceRub: number;
  expensesRub: number;
  totalRub: number;
  costPerKm: number | null;
  trips: number;
  completedTrips: number;
  volumeM3: number;
  downtimeMin: number;
  tripDays: number;
};

export type FleetAnalyticsOwnVsRented = {
  type: 'own' | 'rented';
  units: number;
  trips: number;
  volumeM3: number;
  downtimeMin: number;
  avgDowntimeMin: number | null;
  totalRub: number;
  rubPerTrip: number | null;
  rubPerM3: number | null;
};

export type FleetAnalyticsKpi = {
  from: string;
  to: string;
  vehicleKind: string | null;
  repairCount: number;
  totalRub: number;
  fuelRub: number;
  serviceRub: number;
  expensesRub: number;
  downtimeMin: number;
  /** % загрузки: tripUnitDays / availableUnitDays */
  utilizationPct: number | null;
  tripUnitDays: number;
  availableUnitDays: number;
  availableUnits: number;
  calendarDays: number;
  unitCount: number;
};

export type FleetAnalyticsResult = {
  kpi: FleetAnalyticsKpi;
  byUnit: FleetAnalyticsUnitRow[];
  ownVsRented: FleetAnalyticsOwnVsRented[];
  costsByCategory: { key: string; label: string; rub: number }[];
};
