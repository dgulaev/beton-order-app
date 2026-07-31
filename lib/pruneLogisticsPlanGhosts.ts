/**
 * Вычищение «призраков» из общего плана дня:
 * плановые рейсы без пары в order_mixers («нет в заявке»).
 *
 * morning_payload не трогаем (утренний снимок для learn).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  normalizePlanDateKey,
  type DailyLogisticsPlanPayload,
} from '@/lib/dailyLogisticsPlan';
import {
  liveShippedVolumeForOrder,
  type PlannedTrip,
  type PlannerWave,
} from '@/lib/logisticsPlanner';
import {
  matchAllPlanTripsToFact,
  type FactDayTrip,
} from '@/lib/plannerFactMatch';

export type PruneGhostsResult = {
  pruned: number;
  dates: string[];
};

function parsePayload(raw: unknown): DailyLogisticsPlanPayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  return {
    selectedMixerIds: Array.isArray(p.selectedMixerIds)
      ? p.selectedMixerIds.map(String)
      : [],
    lockedTrips: Array.isArray(p.lockedTrips) ? (p.lockedTrips as PlannedTrip[]) : [],
    manualDoneOrderIds: Array.isArray(p.manualDoneOrderIds)
      ? p.manualDoneOrderIds.map(String)
      : [],
    trips: Array.isArray(p.trips) ? (p.trips as PlannedTrip[]) : [],
    allowNight: Boolean(p.allowNight),
    useTraffic: Boolean(p.useTraffic),
    orderShifts: Array.isArray(p.orderShifts) ? (p.orderShifts as any) : [],
    warnings: Array.isArray(p.warnings) ? (p.warnings as any) : [],
    waves: Array.isArray(p.waves) ? (p.waves as PlannerWave[]) : [],
  };
}

function scrubWaves(waves: PlannerWave[], removedIds: Set<string>): PlannerWave[] {
  if (!waves.length || removedIds.size === 0) return waves;
  return waves.map((w) => {
    const tripIds = (w.tripIds || []).filter((id) => !removedIds.has(String(id)));
    return {
      ...w,
      tripIds,
      tripCount: tripIds.length,
      newTripCount: Math.min(Number(w.newTripCount) || 0, tripIds.length),
    };
  });
}

async function pruneOneDate(
  supabase: SupabaseClient,
  date: string,
  orderIds: number[],
  removeAllForOrders: Set<string>,
  actorName: string,
  attempt = 0,
): Promise<number> {
  if (orderIds.length === 0) return 0;

  const { data: row, error } = await supabase
    .from('daily_logistics_plans')
    .select('delivery_date, payload, revision')
    .eq('delivery_date', date)
    .maybeSingle();

  if (error) {
    if (/relation .*daily_logistics_plans.* does not exist/i.test(error.message || '')) {
      return 0;
    }
    console.warn('pruneGhosts: load plan', date, error.message);
    return 0;
  }
  if (!row) return 0;

  const payload = parsePayload(row.payload);
  if (!payload || (payload.trips.length === 0 && payload.lockedTrips.length === 0)) {
    return 0;
  }

  const target = new Set(orderIds.map(String));
  const touchesPlan = [...payload.trips, ...payload.lockedTrips].some((t) =>
    target.has(String(t.orderId)),
  );
  if (!touchesPlan) return 0;

  const { data: mixers, error: mixErr } = await supabase
    .from('order_mixers')
    .select(
      'id, order_id, mixer_name, volume, status, time, loading_started_at, on_site_at, unloaded_at',
    )
    .in('order_id', orderIds);

  if (mixErr) {
    console.warn('pruneGhosts: load mixers', mixErr.message);
    return 0;
  }

  const dayTrips: FactDayTrip[] = (mixers || []).map((m) => ({
    id: m.id,
    orderId: m.order_id,
    order_id: m.order_id,
    number: m.mixer_name,
    mixer_name: m.mixer_name,
    volume: m.volume,
    status: m.status,
    time: m.time,
    loading_started_at: m.loading_started_at,
    on_site_at: m.on_site_at,
    unloaded_at: m.unloaded_at,
  }));

  const allPlanned = [...payload.trips, ...payload.lockedTrips];
  const facts = matchAllPlanTripsToFact(allPlanned, dayTrips, []);

  const removedIds = new Set<string>();
  const decide = (t: PlannedTrip): PlannedTrip | null => {
    const oid = String(t.orderId);
    if (!target.has(oid)) return t;
    if (removeAllForOrders.has(oid)) {
      removedIds.add(String(t.id));
      return null;
    }
    const fact = facts.get(t.id);
    if (!fact?.hasMatch) {
      removedIds.add(String(t.id));
      return null;
    }
    return fact.matchedTripId && t.orderMixerId == null
      ? { ...t, orderMixerId: fact.matchedTripId }
      : t;
  };

  const nextTrips = payload.trips.map(decide).filter(Boolean) as PlannedTrip[];
  const nextLocked = payload.lockedTrips.map(decide).filter(Boolean) as PlannedTrip[];
  const nextWaves = scrubWaves(payload.waves || [], removedIds);

  const beforeKey = JSON.stringify({
    trips: payload.trips,
    locked: payload.lockedTrips,
    waves: payload.waves || [],
  });
  const afterKey = JSON.stringify({
    trips: nextTrips,
    locked: nextLocked,
    waves: nextWaves,
  });
  if (beforeKey === afterKey) return 0;

  const nextPayload: DailyLogisticsPlanPayload = {
    ...payload,
    trips: nextTrips,
    lockedTrips: nextLocked,
    waves: nextWaves,
  };

  const rev = Number(row.revision) || 1;
  const { data: updated, error: upErr } = await supabase
    .from('daily_logistics_plans')
    .update({
      payload: nextPayload,
      revision: rev + 1,
      updated_at: new Date().toISOString(),
      updated_by_name: actorName,
      updated_by_role: 'system',
    })
    .eq('delivery_date', date)
    .eq('revision', rev)
    .select('delivery_date');

  if (upErr) {
    console.warn('pruneGhosts: update', date, upErr.message);
    return 0;
  }
  if (!updated?.length) {
    if (attempt >= 1) return 0;
    return pruneOneDate(
      supabase,
      date,
      orderIds,
      removeAllForOrders,
      actorName,
      attempt + 1,
    );
  }

  return removedIds.size;
}

/**
 * Вычистить unmatched плановые рейсы по заявкам.
 * Дату берёт из orders.delivery_date (или из opts.deliveryDate, если одна дата).
 */
export async function pruneGhostTripsFromLogisticsPlan(opts: {
  supabase: SupabaseClient;
  orderIds: Array<number | string>;
  deliveryDate?: string | null;
  /** Для этих заявок удалить все плановые рейсы (отмена) */
  removeAllOrderIds?: Array<number | string>;
  actorName?: string | null;
}): Promise<PruneGhostsResult> {
  const ids = [
    ...new Set(
      opts.orderIds
        .map((id) => Number(id))
        .filter((n) => Number.isFinite(n) && n > 0),
    ),
  ];
  if (ids.length === 0) return { pruned: 0, dates: [] };

  const removeAllForOrders = new Set(
    (opts.removeAllOrderIds || []).map(String).filter(Boolean),
  );
  const actorName =
    (typeof opts.actorName === 'string' && opts.actorName.trim()) || 'Система';

  const byDate = new Map<string, number[]>();

  if (opts.deliveryDate) {
    const date = normalizePlanDateKey(String(opts.deliveryDate));
    if (date) byDate.set(date, ids);
  } else {
    const { data: orders, error } = await opts.supabase
      .from('orders')
      .select('id, delivery_date')
      .in('id', ids);
    if (error) {
      console.warn('pruneGhosts: load orders', error.message);
      return { pruned: 0, dates: [] };
    }
    for (const o of orders || []) {
      const date = normalizePlanDateKey(String(o.delivery_date || '').substring(0, 10));
      if (!date) continue;
      const list = byDate.get(date) || [];
      list.push(Number(o.id));
      byDate.set(date, list);
    }
  }

  let pruned = 0;
  const dates: string[] = [];
  for (const [date, orderIds] of byDate) {
    const n = await pruneOneDate(
      opts.supabase,
      date,
      orderIds,
      removeAllForOrders,
      actorName,
    );
    if (n > 0) {
      pruned += n;
      dates.push(date);
    }
  }

  return { pruned, dates };
}

/**
 * Для дня: вычистить «нет в заявке» у заявок, которые в UI уже «отработана»:
 * - status completed / cancelled
 * - или отгруженный объём уже покрывает план (даже если статус ещё processing —
 *   как #729: в UI 100%, в БД processing).
 * cancelled → все плановые рейсы по заявке.
 */
export async function pruneGhostsForDeliveryDate(opts: {
  supabase: SupabaseClient;
  deliveryDate: string;
  actorName?: string | null;
}): Promise<PruneGhostsResult> {
  const date = normalizePlanDateKey(opts.deliveryDate);
  if (!date) return { pruned: 0, dates: [] };

  const { data: planRow } = await opts.supabase
    .from('daily_logistics_plans')
    .select('payload')
    .eq('delivery_date', date)
    .maybeSingle();
  const planTrips = Array.isArray((planRow?.payload as any)?.trips)
    ? ((planRow!.payload as any).trips as PlannedTrip[])
    : [];
  const planOrderIds = [
    ...new Set(
      planTrips
        .map((t) => Number(t.orderId))
        .filter((n) => Number.isFinite(n) && n > 0),
    ),
  ];
  if (planOrderIds.length === 0) return { pruned: 0, dates: [] };

  const { data: orders, error } = await opts.supabase
    .from('orders')
    .select('id, status, volume')
    .in('id', planOrderIds);

  if (error) {
    console.warn('pruneGhostsForDay: orders', error.message);
    return { pruned: 0, dates: [] };
  }

  const { data: mixers } = await opts.supabase
    .from('order_mixers')
    .select('order_id, volume, status, loading_started_at')
    .in('order_id', planOrderIds);

  const doneIds: number[] = [];
  const cancelled: number[] = [];
  for (const o of orders || []) {
    const id = Number(o.id);
    if (!Number.isFinite(id)) continue;
    const st = String(o.status || '');
    if (st === 'cancelled') {
      cancelled.push(id);
      doneIds.push(id);
      continue;
    }
    if (st === 'completed') {
      doneIds.push(id);
      continue;
    }
    // Как бейдж «отработана»: отгрузка покрыла объём заявки
    const planVol = Number(o.volume) || 0;
    if (planVol <= 0) continue;
    const shipped = liveShippedVolumeForOrder(id, mixers || []);
    if (shipped >= planVol - 0.05) doneIds.push(id);
  }

  if (doneIds.length === 0) return { pruned: 0, dates: [] };

  return pruneGhostTripsFromLogisticsPlan({
    supabase: opts.supabase,
    orderIds: doneIds,
    deliveryDate: date,
    removeAllOrderIds: cancelled,
    actorName: opts.actorName,
  });
}
