/**
 * V2: обучение на истории план↔факт — метрики дня и пересчёт калибровки.
 */

import type { DailyLogisticsPlanPayload } from '@/lib/dailyLogisticsPlan';
import type { PlannedTrip } from '@/lib/logisticsPlanner';
import {
  matchAllPlanTripsToFact,
  type FactDayTrip,
  type FactProductionLog,
} from '@/lib/plannerFactMatch';
import {
  PLANNER_LEARN_DAYS,
  type PlannerCalibration,
  type VolumeBucket,
  clamp,
  parseCalibrationPayload,
  robustP50,
  toCalibrationSourceMeta,
  volumeBucket,
} from '@/lib/plannerCalibration';
import { supabaseAdmin as supabase } from '@/lib/supabaseAdmin';

export type SnapshotQuality = 'morning' | 'late';

export type PlanFactMetricRow = {
  delivery_date: string;
  plan_trip_id: string;
  order_id: number | null;
  order_mixer_id: number | null;
  mixer_number: string | null;
  volume_m3: number | null;
  plan_load_at: string | null;
  plan_arrive_at: string | null;
  plan_load_min: number | null;
  plan_road_min: number | null;
  plan_unload_min: number | null;
  fact_load_start: string | null;
  fact_release_at: string | null;
  fact_on_site_at: string | null;
  fact_unloaded_at: string | null;
  delta_load_start_min: number | null;
  fact_load_dur_min: number | null;
  fact_road_min: number | null;
  fact_onsite_min: number | null;
  delta_cycle_min: number | null;
  match_kind: 'sticky' | 'fuzzy' | 'none';
  no_operator: boolean;
  snapshot_quality: SnapshotQuality;
  computed_at: string;
};

function parsePlanMinutes(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const m = String(raw).match(/(\d{1,2}):(\d{2})(?:\s*\(\+(\d+)д\))?/);
  if (!m) return null;
  const day = m[3] ? Number(m[3]) : 0;
  return day * 24 * 60 + Number(m[1]) * 60 + Number(m[2]);
}

function minutesBetweenIso(
  a: string | null | undefined,
  b: string | null | undefined,
): number | null {
  if (!a || !b) return null;
  const ta = new Date(a).getTime();
  const tb = new Date(b).getTime();
  if (Number.isNaN(ta) || Number.isNaN(tb)) return null;
  return Math.round(((tb - ta) / 60000) * 10) / 10;
}

function moscowDayBounds(dateKey: string): { start: string; end: string } {
  const start = new Date(`${dateKey}T00:00:00+03:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  dt.setDate(dt.getDate() + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function round1(n: number | null): number | null {
  if (n == null || !Number.isFinite(n)) return null;
  return Math.round(n * 10) / 10;
}

/** Выбрать trips для обучения: morning_payload приоритетнее. */
export function pickLearnTrips(opts: {
  morningPayload: DailyLogisticsPlanPayload | null | undefined;
  payload: DailyLogisticsPlanPayload | null | undefined;
}): { trips: PlannedTrip[]; quality: SnapshotQuality } {
  const morningTrips = opts.morningPayload?.trips;
  if (Array.isArray(morningTrips) && morningTrips.length > 0) {
    return { trips: morningTrips, quality: 'morning' };
  }
  const late = opts.payload?.trips;
  return {
    trips: Array.isArray(late) ? late : [],
    quality: 'late',
  };
}

export function buildDayMetrics(opts: {
  dateKey: string;
  trips: PlannedTrip[];
  dayTrips: FactDayTrip[];
  productionLogs: FactProductionLog[];
  snapshotQuality: SnapshotQuality;
}): PlanFactMetricRow[] {
  const { dateKey, trips, dayTrips, productionLogs, snapshotQuality } = opts;
  const matchMap = matchAllPlanTripsToFact(trips, dayTrips, productionLogs);
  const byId = new Map(
    dayTrips
      .filter((t) => t.id != null)
      .map((t) => [String(t.id), t] as const),
  );
  const nowIso = new Date().toISOString();
  const rows: PlanFactMetricRow[] = [];

  for (const planned of trips) {
    const fact = matchMap.get(planned.id);
    const matchKind: PlanFactMetricRow['match_kind'] = !fact?.hasMatch
      ? 'none'
      : fact.sticky
        ? 'sticky'
        : 'fuzzy';
    const live = fact?.matchedTripId
      ? byId.get(String(fact.matchedTripId))
      : null;
    const log = productionLogs.find(
      (l) => String(l.order_mixer_id) === String(fact?.matchedTripId),
    );

    // Приоритет факта загрузки: production_logs, иначе loading_started_at
    const loadStartIso =
      log?.start_time ||
      (live as any)?.loading_started_at ||
      (live as any)?.loadingStartedAt ||
      null;
    const releaseIso = log?.end_time || null;
    const onSiteIso = (live as any)?.on_site_at || null;
    const unloadedIso = (live as any)?.unloaded_at || null;

    const factLoadDur = minutesBetweenIso(loadStartIso, releaseIso);
    const factRoad = minutesBetweenIso(releaseIso, onSiteIso);
    const factOnsite = minutesBetweenIso(onSiteIso, unloadedIso);

    const planCycle =
      (Number(planned.loadMin) || 0) +
      2 * (Number(planned.roadMin) || 0) +
      (Number(planned.unloadMin) || 0);
    const factCycle = minutesBetweenIso(loadStartIso, unloadedIso);
    const deltaCycle =
      factCycle != null && planCycle > 0 ? round1(factCycle - planCycle) : null;

    rows.push({
      delivery_date: dateKey,
      plan_trip_id: String(planned.id),
      order_id: Number.isFinite(Number(planned.orderId))
        ? Number(planned.orderId)
        : null,
      order_mixer_id: fact?.matchedTripId ?? null,
      mixer_number: planned.mixerNumber || null,
      volume_m3: Number.isFinite(Number(planned.volume))
        ? Number(planned.volume)
        : null,
      plan_load_at: planned.loadTime || null,
      plan_arrive_at: planned.arriveTime || null,
      plan_load_min: round1(Number(planned.loadMin) || null),
      plan_road_min: round1(Number(planned.roadMin) || null),
      plan_unload_min: round1(Number(planned.unloadMin) || null),
      fact_load_start: loadStartIso,
      fact_release_at: releaseIso,
      fact_on_site_at: onSiteIso,
      fact_unloaded_at: unloadedIso,
      delta_load_start_min: round1(fact?.deltaLoadMin ?? null),
      fact_load_dur_min: round1(factLoadDur),
      fact_road_min: round1(factRoad),
      fact_onsite_min: round1(factOnsite),
      delta_cycle_min: deltaCycle,
      match_kind: matchKind,
      no_operator: Boolean(fact?.noOperatorRecord),
      snapshot_quality: snapshotQuality,
      computed_at: nowIso,
    });
  }

  return rows;
}

export async function fetchDayFactSources(dateKey: string): Promise<{
  dayTrips: FactDayTrip[];
  productionLogs: FactProductionLog[];
}> {
  const { data: orders, error: ordErr } = await supabase
    .from('orders')
    .select('id')
    .eq('delivery_date', dateKey)
    .neq('status', 'cancelled');
  if (ordErr) throw ordErr;

  const orderIds = (orders || [])
    .map((o) => Number(o.id))
    .filter((id) => Number.isFinite(id) && id > 0);

  let dayTrips: FactDayTrip[] = [];
  for (let i = 0; i < orderIds.length; i += 150) {
    const slice = orderIds.slice(i, i + 150);
    const { data, error } = await supabase
      .from('order_mixers')
      .select(
        'id, order_id, mixer_name, volume, status, time, loading_started_at, on_site_at, unloaded_at',
      )
      .in('order_id', slice);
    if (error) throw error;
    for (const row of data || []) {
      dayTrips.push({
        id: row.id,
        orderId: row.order_id,
        order_id: row.order_id,
        number: row.mixer_name,
        mixer_name: row.mixer_name,
        volume: row.volume,
        status: row.status,
        time: row.time,
        loading_started_at: row.loading_started_at,
        on_site_at: (row as any).on_site_at,
        unloaded_at: (row as any).unloaded_at,
      } as FactDayTrip & { on_site_at?: string; unloaded_at?: string });
    }
  }

  const { start, end } = moscowDayBounds(dateKey);
  // no_operator_record — НЕ колонка БД, а флаг сироты в GET production-log.
  // Select этой колонки валил весь learn/backfill (метрики оставались пустыми).
  const { data: logs, error: logErr } = await supabase
    .from('production_logs')
    .select(
      'id, order_id, order_mixer_id, start_time, end_time, mixer_name, volume',
    )
    .gte('start_time', start)
    .lt('start_time', end);
  if (logErr) throw logErr;

  // Также логи по order_mixer_id дня (если start_time в другом дне)
  const mixerIds = dayTrips
    .map((t) => Number(t.id))
    .filter((id) => Number.isFinite(id) && id > 0);
  let extraLogs: FactProductionLog[] = [];
  if (mixerIds.length > 0) {
    for (let i = 0; i < mixerIds.length; i += 150) {
      const slice = mixerIds.slice(i, i + 150);
      const { data, error } = await supabase
        .from('production_logs')
        .select(
          'id, order_id, order_mixer_id, start_time, end_time, mixer_name, volume',
        )
        .in('order_mixer_id', slice);
      if (error) throw error;
      extraLogs = extraLogs.concat((data || []) as FactProductionLog[]);
    }
  }

  const byLogId = new Map<string, FactProductionLog>();
  for (const l of [...(logs || []), ...extraLogs] as FactProductionLog[]) {
    byLogId.set(String(l.id), l);
  }

  return {
    dayTrips,
    productionLogs: [...byLogId.values()],
  };
}

export async function learnDay(dateKey: string): Promise<{
  date: string;
  tripCount: number;
  matched: number;
  snapshotQuality: SnapshotQuality;
  upserted: number;
}> {
  let planRow: {
    payload?: unknown;
    morning_payload?: unknown;
  } | null = null;
  {
    const first = await supabase
      .from('daily_logistics_plans')
      .select('payload, morning_payload')
      .eq('delivery_date', dateKey)
      .maybeSingle();
    if (first.error && /morning_/i.test(first.error.message || '')) {
      const retry = await supabase
        .from('daily_logistics_plans')
        .select('payload')
        .eq('delivery_date', dateKey)
        .maybeSingle();
      if (retry.error) throw retry.error;
      planRow = retry.data;
    } else if (first.error) {
      throw first.error;
    } else {
      planRow = first.data;
    }
  }

  const { trips, quality } = pickLearnTrips({
    morningPayload: planRow?.morning_payload as DailyLogisticsPlanPayload | null,
    payload: planRow?.payload as DailyLogisticsPlanPayload | null,
  });

  if (trips.length === 0) {
    return {
      date: dateKey,
      tripCount: 0,
      matched: 0,
      snapshotQuality: quality,
      upserted: 0,
    };
  }

  const { dayTrips, productionLogs } = await fetchDayFactSources(dateKey);
  const rows = buildDayMetrics({
    dateKey,
    trips,
    dayTrips,
    productionLogs,
    snapshotQuality: quality,
  });

  const matched = rows.filter((r) => r.match_kind !== 'none').length;

  // upsert чанками
  let upserted = 0;
  for (let i = 0; i < rows.length; i += 80) {
    const chunk = rows.slice(i, i + 80);
    const { error } = await supabase
      .from('plan_fact_trip_metrics')
      .upsert(chunk, { onConflict: 'delivery_date,plan_trip_id' });
    if (error) throw error;
    upserted += chunk.length;
  }

  return {
    date: dateKey,
    tripCount: trips.length,
    matched,
    snapshotQuality: quality,
    upserted,
  };
}

export async function recomputeCalibration(
  days = PLANNER_LEARN_DAYS,
): Promise<PlannerCalibration> {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const from = addDaysYmd(today, -(days - 1));

  const { data, error } = await supabase
    .from('plan_fact_trip_metrics')
    .select(
      'delivery_date, volume_m3, plan_road_min, fact_load_dur_min, fact_road_min, fact_onsite_min, fact_load_start, fact_unloaded_at, match_kind, plan_load_at, plan_arrive_at, order_id, mixer_number, plan_trip_id',
    )
    .gte('delivery_date', from)
    .lte('delivery_date', today)
    .neq('match_kind', 'none');
  if (error) throw error;

  const rows = data || [];
  const daysUsed = new Set(rows.map((r) => String(r.delivery_date))).size;

  const loadAll: number[] = [];
  const loadBuckets: Record<VolumeBucket, number[]> = {
    le8: [],
    le10: [],
    gt10: [],
  };
  const roadFactors: number[] = [];
  const roadPeak: number[] = [];
  const roadOff: number[] = [];
  const unload: number[] = [];

  for (const r of rows) {
    const dur = Number(r.fact_load_dur_min);
    if (Number.isFinite(dur) && dur >= 4 && dur <= 40) {
      loadAll.push(dur);
      const b = volumeBucket(Number(r.volume_m3) || 0);
      loadBuckets[b].push(dur);
    }
    const factRoad = Number(r.fact_road_min);
    const planRoad = Number(r.plan_road_min);
    if (
      Number.isFinite(factRoad) &&
      Number.isFinite(planRoad) &&
      planRoad >= 5 &&
      factRoad >= 3 &&
      factRoad <= 180
    ) {
      const factor = factRoad / planRoad;
      if (factor >= 0.4 && factor <= 2.5) {
        roadFactors.push(factor);
        // грубо: load hour из plan_load_at
        const hm = String(r.plan_load_at || '').match(/(\d{1,2}):/);
        const hour = hm ? Number(hm[1]) : 12;
        const peak = (hour >= 7 && hour < 9) || (hour >= 16 && hour < 18);
        if (peak) roadPeak.push(factor);
        else roadOff.push(factor);
      }
    }
    const onsite = Number(r.fact_onsite_min);
    if (Number.isFinite(onsite) && onsite >= 8 && onsite <= 90) {
      unload.push(onsite);
    }
  }

  // стык: fact unloadDoneₙ → loadStartₙ₊₁ того же миксера
  const joinSamples: number[] = [];
  const byDateMixer = new Map<string, typeof rows>();
  for (const r of rows) {
    const mixer = String(r.mixer_number || '').trim();
    if (!mixer) continue;
    const key = `${r.delivery_date}|${mixer}`;
    const list = byDateMixer.get(key) || [];
    list.push(r);
    byDateMixer.set(key, list);
  }
  for (const list of byDateMixer.values()) {
    const sorted = [...list].sort((a, b) => {
      const am = parsePlanMinutes(String(a.plan_load_at || '')) ?? 0;
      const bm = parsePlanMinutes(String(b.plan_load_at || '')) ?? 0;
      return am - bm;
    });
    for (let i = 0; i < sorted.length - 1; i++) {
      const gap = minutesBetweenIso(
        sorted[i].fact_unloaded_at as string | null,
        sorted[i + 1].fact_load_start as string | null,
      );
      if (gap != null && gap >= 0 && gap <= 30) joinSamples.push(gap);
    }
  }

  const loadP50 = robustP50(loadAll);
  const calib: PlannerCalibration = {
    loadByBucket: {
      le8: robustP50(loadBuckets.le8) ?? undefined,
      le10: robustP50(loadBuckets.le10) ?? undefined,
      gt10: robustP50(loadBuckets.gt10) ?? undefined,
    },
    loadP50: loadP50 != null ? clamp(loadP50, 8, 18) : null,
    roadFactorOffpeak:
      robustP50(roadOff.length ? roadOff : roadFactors) != null
        ? clamp(robustP50(roadOff.length ? roadOff : roadFactors)!, 0.75, 1.35)
        : null,
    roadFactorPeak:
      robustP50(roadPeak.length ? roadPeak : roadFactors) != null
        ? clamp(robustP50(roadPeak.length ? roadPeak : roadFactors)!, 0.75, 1.35)
        : null,
    unloadP50:
      robustP50(unload) != null ? clamp(robustP50(unload)!, 20, 45) : null,
    joinBufferP50:
      robustP50(joinSamples) != null
        ? clamp(robustP50(joinSamples)!, 3, 10)
        : null,
    samples: loadAll.length,
    daysUsed,
    updatedAt: new Date().toISOString(),
  };

  // clamp bucket values
  for (const k of Object.keys(calib.loadByBucket) as VolumeBucket[]) {
    const v = calib.loadByBucket[k];
    if (v != null) calib.loadByBucket[k] = clamp(v, 8, 18);
  }

  const payload = {
    ...calib,
    meta: toCalibrationSourceMeta(calib),
  };

  const { error: upErr } = await supabase.from('planner_calibration_current').upsert(
    {
      id: 1,
      payload,
      samples: calib.samples,
      days_used: calib.daysUsed,
      updated_at: calib.updatedAt,
    },
    { onConflict: 'id' },
  );
  if (upErr) throw upErr;

  return calib;
}

export async function loadCurrentCalibration(): Promise<PlannerCalibration> {
  const { data, error } = await supabase
    .from('planner_calibration_current')
    .select('payload, samples, days_used, updated_at')
    .eq('id', 1)
    .maybeSingle();
  if (error) {
    // таблица ещё не применена
    if (/planner_calibration_current|does not exist/i.test(error.message || '')) {
      return parseCalibrationPayload(null);
    }
    throw error;
  }
  if (!data) return parseCalibrationPayload(null);
  const parsed = parseCalibrationPayload(data.payload);
  return {
    ...parsed,
    samples: Math.max(parsed.samples, Number(data.samples) || 0),
    daysUsed: Math.max(parsed.daysUsed, Number(data.days_used) || 0),
    updatedAt: data.updated_at ? String(data.updated_at) : parsed.updatedAt,
  };
}

export async function backfillLearn(days = PLANNER_LEARN_DAYS): Promise<{
  days: string[];
  results: Array<{
    date: string;
    tripCount: number;
    matched: number;
    snapshotQuality: SnapshotQuality;
    upserted: number;
    error?: string;
  }>;
  calibration: PlannerCalibration;
}> {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

  const dates: string[] = [];
  for (let i = days - 1; i >= 0; i--) dates.push(addDaysYmd(today, -i));

  const results: Array<{
    date: string;
    tripCount: number;
    matched: number;
    snapshotQuality: SnapshotQuality;
    upserted: number;
    error?: string;
  }> = [];

  for (const d of dates) {
    try {
      results.push(await learnDay(d));
    } catch (e: any) {
      results.push({
        date: d,
        tripCount: 0,
        matched: 0,
        snapshotQuality: 'late',
        upserted: 0,
        error: e?.message || String(e),
      });
    }
  }

  const calibration = await recomputeCalibration(days);
  return { days: dates, results, calibration };
}
