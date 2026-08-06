/** Фаза 5 FMS — серверная агрегация аналитики парка (supabaseAdmin). */

import {
  computeFleetCostPeriod,
  defaultCostPeriod,
} from '@/lib/fleetCosts';
import type { LifecycleStatus } from '@/lib/fleetLifecycle';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import {
  tracksOwnershipCost,
  type FleetAnalyticsFilters,
  type FleetAnalyticsOwnVsRented,
  type FleetAnalyticsResult,
  type FleetAnalyticsUnitRow,
} from '@/lib/fleetAnalyticsShared';

export type {
  FleetAnalyticsFilters,
  FleetAnalyticsKpi,
  FleetAnalyticsOwnVsRented,
  FleetAnalyticsResult,
  FleetAnalyticsUnitRow,
} from '@/lib/fleetAnalyticsShared';
export {
  ownershipTypeLabel,
  tracksOwnershipCost,
} from '@/lib/fleetAnalyticsShared';

type MixerRow = {
  id: number;
  number: string;
  model: string | null;
  vehicle_kind: string | null;
  type: string | null;
  lifecycle_status: string | null;
  odometer_km: number | null;
  specs: Record<string, unknown> | null;
};

function ymdValid(v: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(v);
}

/** Число календарных дней включительно (МСК-даты как YYYY-MM-DD). */
export function calendarDaysInclusive(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00+03:00`);
  const b = Date.parse(`${to}T00:00:00+03:00`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return 1;
  return Math.max(1, Math.round((b - a) / 86_400_000) + 1);
}

function isAvailableForLoad(lifecycle: string | null | undefined): boolean {
  const s = (lifecycle || 'active') as LifecycleStatus | string;
  // sold / conservation / repair — не в знаменателе загрузки
  return s !== 'sold' && s !== 'conservation' && s !== 'repair';
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** PostgREST по умолчанию отдаёт ≤1000 строк — без лимита режем затраты. */
const ROWS_LIMIT = 20_000;
const IN_CHUNK = 80;

async function fetchInChunks<T>(
  ids: number[],
  fetchChunk: (chunk: number[]) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  if (ids.length === 0) return [];
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const chunk = ids.slice(i, i + IN_CHUNK);
    const { data, error } = await fetchChunk(chunk);
    if (error) {
      // Таблица может отсутствовать до миграции
      if (/fuel_entries|fleet_expenses|fleet_service|does not exist|relation/i.test(error.message)) {
        return [];
      }
      throw new Error(error.message);
    }
    if (data?.length) out.push(...data);
  }
  return out;
}

/**
 * Собирает аналитику парка за период.
 * Рейсы матчатся по mixers.number === order_mixers.mixer_name.
 */
export async function buildFleetAnalytics(
  filters: FleetAnalyticsFilters = {},
): Promise<FleetAnalyticsResult> {
  const defaults = defaultCostPeriod();
  let from = filters.from && ymdValid(filters.from) ? filters.from : defaults.from;
  let to = filters.to && ymdValid(filters.to) ? filters.to : defaults.to;
  if (from > to) {
    const tmp = from;
    from = to;
    to = tmp;
  }
  const vehicleKind =
    filters.vehicleKind && filters.vehicleKind !== 'all' ? filters.vehicleKind : null;

  let mixersQuery = supabaseAdmin
    .from('mixers')
    .select('id, number, model, vehicle_kind, type, lifecycle_status, odometer_km, specs')
    .order('number', { ascending: true });

  if (vehicleKind) {
    mixersQuery = mixersQuery.eq('vehicle_kind', vehicleKind);
  }

  const { data: mixersRaw, error: mixersErr } = await mixersQuery;
  if (mixersErr) {
    throw new Error(mixersErr.message);
  }

  const mixers = (mixersRaw ?? []) as MixerRow[];
  const mixerIds = mixers.map((m) => m.id);
  const numberToId = new Map(mixers.map((m) => [m.number, m.id]));
  const days = calendarDaysInclusive(from, to);

  const empty: FleetAnalyticsResult = {
    kpi: {
      from,
      to,
      vehicleKind,
      repairCount: 0,
      totalRub: 0,
      fuelRub: 0,
      serviceRub: 0,
      expensesRub: 0,
      downtimeMin: 0,
      utilizationPct: null,
      tripUnitDays: 0,
      availableUnitDays: 0,
      availableUnits: 0,
      calendarDays: days,
      unitCount: 0,
    },
    byUnit: [],
    ownVsRented: [
      {
        type: 'own',
        units: 0,
        trips: 0,
        volumeM3: 0,
        downtimeMin: 0,
        avgDowntimeMin: null,
        totalRub: 0,
        rubPerTrip: null,
        rubPerM3: null,
      },
      {
        type: 'rented',
        units: 0,
        trips: 0,
        volumeM3: 0,
        downtimeMin: 0,
        avgDowntimeMin: null,
        totalRub: 0,
        rubPerTrip: null,
        rubPerM3: null,
      },
    ],
    costsByCategory: [
      { key: 'fuel', label: 'Топливо', rub: 0 },
      { key: 'service', label: 'ТО / сервис', rub: 0 },
      { key: 'expenses', label: 'Прочие расходы', rub: 0 },
    ],
  };

  if (mixerIds.length === 0) {
    return empty;
  }

  const fromIso = `${from}T00:00:00+03:00`;
  const toIso = `${to}T23:59:59.999+03:00`;
  const names = mixers.map((m) => m.number).filter(Boolean);

  const [fuelRows, expRows, svcRows, tripRowsRaw] = await Promise.all([
    fetchInChunks(mixerIds, (chunk) =>
      supabaseAdmin
        .from('fuel_entries')
        .select('mixer_id, liters, amount_rub, odometer_km, fuel_type')
        .in('mixer_id', chunk)
        .gte('filled_at', fromIso)
        .lte('filled_at', toIso)
        .limit(ROWS_LIMIT),
    ),
    fetchInChunks(mixerIds, (chunk) =>
      supabaseAdmin
        .from('fleet_expenses')
        .select('mixer_id, amount_rub')
        .in('mixer_id', chunk)
        .gte('expense_date', from)
        .lte('expense_date', to)
        .limit(ROWS_LIMIT),
    ),
    fetchInChunks(mixerIds, (chunk) =>
      supabaseAdmin
        .from('fleet_service_records')
        .select('mixer_id, labor_cost, parts_cost, odometer_km, status')
        .in('mixer_id', chunk)
        .eq('status', 'done')
        .gte('service_date', from)
        .lte('service_date', to)
        .limit(ROWS_LIMIT),
    ),
    (async () => {
      if (!names.length) return [] as Array<Record<string, unknown>>;
      const out: Array<Record<string, unknown>> = [];
      for (let i = 0; i < names.length; i += IN_CHUNK) {
        const chunk = names.slice(i, i + IN_CHUNK);
        // !inner + фильтр по дате — иначе limit режет чужой период и теряем рейсы
        const { data, error } = await supabaseAdmin
          .from('order_mixers')
          .select(
            `
            id,
            mixer_name,
            volume,
            status,
            downtime_minutes,
            orders!inner (
              delivery_date
            )
          `,
          )
          .in('mixer_name', chunk)
          .gte('orders.delivery_date', from)
          .lte('orders.delivery_date', to)
          .limit(ROWS_LIMIT);
        if (error) {
          // fallback без !inner (старые схемы / RLS)
          const fb = await supabaseAdmin
            .from('order_mixers')
            .select(
              `
              id,
              mixer_name,
              volume,
              status,
              downtime_minutes,
              orders (
                delivery_date
              )
            `,
            )
            .in('mixer_name', chunk)
            .order('created_at', { ascending: false })
            .limit(ROWS_LIMIT);
          if (fb.error) break;
          for (const row of fb.data ?? []) out.push(row as Record<string, unknown>);
          continue;
        }
        if (data?.length) out.push(...(data as Array<Record<string, unknown>>));
      }
      return out;
    })(),
  ]);

  type TripAgg = {
    trips: number;
    completedTrips: number;
    volumeM3: number;
    downtimeMin: number;
    days: Set<string>;
  };

  const tripByMixer = new Map<number, TripAgg>();
  for (const id of mixerIds) {
    tripByMixer.set(id, {
      trips: 0,
      completedTrips: 0,
      volumeM3: 0,
      downtimeMin: 0,
      days: new Set(),
    });
  }

  for (const raw of tripRowsRaw) {
    const row = raw as {
      mixer_name?: string | null;
      volume?: number | null;
      status?: string | null;
      downtime_minutes?: number | null;
      orders?: { delivery_date?: string | null } | { delivery_date?: string | null }[] | null;
    };
    const name = row.mixer_name || '';
    const mixerId = numberToId.get(name);
    if (mixerId == null) continue;

    const ord = Array.isArray(row.orders) ? row.orders[0] : row.orders;
    const dateStr = ord?.delivery_date ? String(ord.delivery_date).slice(0, 10) : '';
    if (!dateStr || dateStr < from || dateStr > to) continue;

    const agg = tripByMixer.get(mixerId)!;
    agg.trips += 1;
    const st = row.status || '';
    const completed = st === 'Разгружен' || st === 'Возврат';
    if (completed) {
      agg.completedTrips += 1;
      agg.volumeM3 += Number(row.volume) || 0;
      agg.downtimeMin += Number(row.downtime_minutes) || 0;
    }
    agg.days.add(dateStr);
  }

  type CostBucket = {
    fuelRub: number;
    fuelLiters: number;
    serviceRub: number;
    expensesRub: number;
    odo: number[];
  };
  const costByMixer = new Map<number, CostBucket>();
  for (const id of mixerIds) {
    costByMixer.set(id, {
      fuelRub: 0,
      fuelLiters: 0,
      serviceRub: 0,
      expensesRub: 0,
      odo: [],
    });
  }

  for (const f of fuelRows) {
    const id = Number(f.mixer_id);
    const b = costByMixer.get(id);
    if (!b) continue;
    if (String(f.fuel_type || '') === 'drain') continue;
    b.fuelLiters += Number(f.liters) || 0;
    b.fuelRub += Number(f.amount_rub) || 0;
    if (f.odometer_km != null && Number.isFinite(Number(f.odometer_km))) {
      b.odo.push(Number(f.odometer_km));
    }
  }
  for (const e of expRows) {
    const id = Number(e.mixer_id);
    const b = costByMixer.get(id);
    if (!b) continue;
    b.expensesRub += Number(e.amount_rub) || 0;
  }
  for (const s of svcRows) {
    const id = Number(s.mixer_id);
    const b = costByMixer.get(id);
    if (!b) continue;
    b.serviceRub += (Number(s.labor_cost) || 0) + (Number(s.parts_cost) || 0);
    if (s.odometer_km != null && Number.isFinite(Number(s.odometer_km))) {
      b.odo.push(Number(s.odometer_km));
    }
  }

  const byUnit: FleetAnalyticsUnitRow[] = [];
  let fuelRubTotal = 0;
  let serviceRubTotal = 0;
  let expensesRubTotal = 0;
  let downtimeTotal = 0;
  let repairCount = 0;
  let tripUnitDays = 0;
  let availableUnits = 0;

  for (const m of mixers) {
    const kind = m.vehicle_kind || 'mixer';
    const type = m.type || 'own';
    const ownership = tracksOwnershipCost({ type, vehicleKind: kind });

    if (m.lifecycle_status === 'repair' && ownership) repairCount += 1;

    const trips = tripByMixer.get(m.id)!;
    const isOwn = type === 'own';
    if (isOwn && isAvailableForLoad(m.lifecycle_status)) {
      availableUnits += 1;
      tripUnitDays += trips.days.size;
    }

    // Наёмные миксеры и прочий подряд — не в стоимости владения и не в таблице
    if (!ownership) continue;

    const costs = costByMixer.get(m.id)!;
    if (m.odometer_km != null && Number.isFinite(Number(m.odometer_km))) {
      costs.odo.push(Number(m.odometer_km));
    }

    const specs = (m.specs && typeof m.specs === 'object' ? m.specs : {}) as Record<
      string,
      unknown
    >;
    const fuelNorm =
      specs.fuel_norm_l_per_100km != null ? Number(specs.fuel_norm_l_per_100km) : null;

    const period = computeFleetCostPeriod({
      from,
      to,
      fuelRub: costs.fuelRub,
      fuelLiters: costs.fuelLiters,
      serviceRub: costs.serviceRub,
      expensesRub: costs.expensesRub,
      odometerReadings: costs.odo,
      fuelNormLPer100km: fuelNorm,
    });

    fuelRubTotal += period.fuelRub;
    serviceRubTotal += period.serviceRub;
    expensesRubTotal += period.expensesRub;
    downtimeTotal += trips.downtimeMin;

    byUnit.push({
      mixerId: m.id,
      number: m.number,
      model: m.model,
      vehicleKind: kind,
      type,
      lifecycleStatus: m.lifecycle_status,
      fuelRub: round2(period.fuelRub),
      fuelLiters: round1(period.fuelLiters),
      serviceRub: round2(period.serviceRub),
      expensesRub: round2(period.expensesRub),
      totalRub: round2(period.totalRub),
      costPerKm: period.costPerKm != null ? round2(period.costPerKm) : null,
      trips: trips.trips,
      completedTrips: trips.completedTrips,
      volumeM3: round1(trips.volumeM3),
      downtimeMin: trips.downtimeMin,
      tripDays: trips.days.size,
    });
  }

  byUnit.sort((a, b) => b.totalRub - a.totalRub || a.number.localeCompare(b.number, 'ru'));

  const availableUnitDays = availableUnits * days;
  const utilizationPct =
    availableUnitDays > 0
      ? round1(Math.min(100, (tripUnitDays / availableUnitDays) * 100))
      : null;

  const aggregateSide = (side: 'own' | 'rented'): FleetAnalyticsOwnVsRented => {
    const rows = byUnit.filter((u) => (u.type || 'own') === side);
    const trips = rows.reduce((s, u) => s + u.trips, 0);
    const volumeM3 = round1(rows.reduce((s, u) => s + u.volumeM3, 0));
    const downtimeMin = rows.reduce((s, u) => s + u.downtimeMin, 0);
    const totalRub = round2(rows.reduce((s, u) => s + u.totalRub, 0));
    const completed = rows.reduce((s, u) => s + u.completedTrips, 0);
    return {
      type: side,
      units: rows.length,
      trips,
      volumeM3,
      downtimeMin,
      avgDowntimeMin: completed > 0 ? round1(downtimeMin / completed) : null,
      totalRub,
      rubPerTrip: trips > 0 ? round2(totalRub / trips) : null,
      rubPerM3: volumeM3 > 0 ? round2(totalRub / volumeM3) : null,
    };
  };

  const totalRub = round2(fuelRubTotal + serviceRubTotal + expensesRubTotal);

  return {
    kpi: {
      from,
      to,
      vehicleKind,
      repairCount,
      totalRub,
      fuelRub: round2(fuelRubTotal),
      serviceRub: round2(serviceRubTotal),
      expensesRub: round2(expensesRubTotal),
      downtimeMin: downtimeTotal,
      utilizationPct,
      tripUnitDays,
      availableUnitDays,
      availableUnits,
      calendarDays: days,
      unitCount: byUnit.length,
    },
    byUnit,
    ownVsRented: [aggregateSide('own'), aggregateSide('rented')],
    costsByCategory: [
      { key: 'fuel', label: 'Топливо', rub: round2(fuelRubTotal) },
      { key: 'service', label: 'ТО / сервис', rub: round2(serviceRubTotal) },
      { key: 'expenses', label: 'Прочие расходы', rub: round2(expensesRubTotal) },
    ],
  };
}
