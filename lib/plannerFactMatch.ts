/**
 * Фаза 5: матчинг планового рейса интеллекта ↔ live order_mixers + production_logs.
 * Closed-loop: жёсткая 1:1 через PlannedTrip.orderMixerId, иначе строгий матч.
 */

import {
  PICKUP_MIXER_NUMBER,
  PLANNER_FACT_SHIPPED_STATUSES,
  type PlannedTrip,
} from '@/lib/logisticsPlanner';
import { formatTimeHHMM } from '@/lib/ruLocale';

export type FactDayTrip = {
  id?: number | string;
  orderId?: number | string | null;
  order_id?: number | string | null;
  number?: string | null;
  mixer_name?: string | null;
  volume?: number | string | null;
  status?: string | null;
  time?: string | null;
  loading_started_at?: string | null;
  loadingStartedAt?: string | null;
  /** V2: факт на объекте / разгружен */
  on_site_at?: string | null;
  unloaded_at?: string | null;
};

export type FactProductionLog = {
  id?: number | string;
  order_id?: number | string | null;
  order_mixer_id?: number | string | null;
  start_time?: string | null;
  end_time?: string | null;
  mixer_name?: string | null;
  volume?: number | string | null;
  no_operator_record?: boolean | null;
  delivery_date?: string | null;
};

export type PlanTripFact = {
  matchedTripId: number | null;
  factStatus: string | null;
  factLoadStart: string | null;
  factRelease: string | null;
  /** Плановое время загрузки live-рейса (order_mixers.time), HH:MM */
  factPlanTime: string | null;
  factVolume: number | null;
  deltaLoadMin: number | null;
  deltaReleaseMin: number | null;
  noOperatorRecord: boolean;
  hasMatch: boolean;
  /** Матч по сохранённому orderMixerId (жёсткая 1:1). */
  sticky?: boolean;
};

/** Латиница ↔ кириллица в госномерах (O/О, Y/У, X/Х …). */
const PLATE_LOOKALIKES: Record<string, string> = {
  А: 'A',
  В: 'B',
  Е: 'E',
  К: 'K',
  М: 'M',
  Н: 'H',
  О: 'O',
  Р: 'P',
  С: 'C',
  Т: 'T',
  У: 'Y',
  Х: 'X',
};

function normalizeMixerKey(raw: string): string {
  return String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/ё/g, 'Е')
    .replace(/[\s\-_.]/g, '')
    .replace(/[АВЕКМНОРСТУХ]/g, (ch) => PLATE_LOOKALIKES[ch] || ch);
}

function scoreCandidate(
  t: FactDayTrip,
  planned: PlannedTrip,
  planLoadMin: number | null,
): number {
  const st = String(t.status || '');
  const shipped =
    (PLANNER_FACT_SHIPPED_STATUSES as readonly string[]).includes(st) ||
    (st === 'Загрузка' && Boolean(t.loading_started_at || t.loadingStartedAt));
  const active = ['Загрузка', 'В пути', 'На объекте', 'Проблема'].includes(st);
  const tMin = parseClockMinutes(String(t.time || ''));
  const volDiff = Math.abs((Number(t.volume) || 0) - (Number(planned.volume) || 0));
  const timeDiff = timeDiffAcrossDays(planLoadMin, tMin);
  return (shipped || active ? 0 : 500) + volDiff * 10 + timeDiff;
}

const DAY_MIN = 24 * 60;

/** «HH:MM» или «HH:MM (+Nd)» → абсолютные минуты от полуночи дня плана. */
function parsePlanMinutes(t: string): number | null {
  const m = String(t || '')
    .trim()
    .match(/^(\d{1,2}):(\d{2})(?:\s*\(\+(\d+)д\))?/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  const dayOffset = Number(m[3] || 0);
  if (!Number.isFinite(h) || !Number.isFinite(min)) return null;
  return dayOffset * DAY_MIN + h * 60 + min;
}

/** Только часы:минуты факта (order_mixers.time без дня). */
function parseClockMinutes(t: string): number | null {
  const m = String(t || '')
    .trim()
    .match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min)) return null;
  return h * 60 + min;
}

/**
 * Разница план↔факт с учётом суток: факт — только HH:MM, план может быть (+1д).
 * Берём минимальный |fact + d·1440 − planAbs| по возможным дням.
 */
function timeDiffAcrossDays(
  planAbsMin: number | null,
  factClockMin: number | null,
): number {
  if (planAbsMin == null || factClockMin == null) return 9999;
  const maxDay = Math.max(0, Math.floor(planAbsMin / DAY_MIN) + 1);
  let best = Infinity;
  for (let d = 0; d <= maxDay; d++) {
    best = Math.min(best, Math.abs(factClockMin + d * DAY_MIN - planAbsMin));
  }
  return best;
}

/** ISO / timestamp → HH:MM локально */
export function isoToHhMm(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return formatTimeHHMM(String(iso)) || null;
  }
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function deltaMinutes(planHhMm: string | null | undefined, factHhMm: string | null): number | null {
  if (!planHhMm || !factHhMm) return null;
  const p = parsePlanMinutes(planHhMm);
  const fClock = parseClockMinutes(factHhMm);
  if (p == null || fClock == null) return null;
  // Ближайший день факта к абсолютному плану (для (+1д) не крутим ±12ч вслепую)
  const maxDay = Math.max(0, Math.floor(p / DAY_MIN) + 1);
  let best: number | null = null;
  for (let d = 0; d <= maxDay; d++) {
    const cand = fClock + d * DAY_MIN - p;
    if (best == null || Math.abs(cand) < Math.abs(best)) best = cand;
  }
  return best;
}

function formatDelta(d: number | null): string | null {
  if (d == null) return null;
  if (d === 0) return '±0';
  return d > 0 ? `+${d}` : `${d}`;
}

export function formatFactDeltaLabel(d: number | null): string | null {
  const raw = formatDelta(d);
  if (raw == null) return null;
  return `${raw} мин`;
}

const emptyFact = (): PlanTripFact => ({
  matchedTripId: null,
  factStatus: null,
  factLoadStart: null,
  factRelease: null,
  factPlanTime: null,
  factVolume: null,
  deltaLoadMin: null,
  deltaReleaseMin: null,
  noOperatorRecord: false,
  hasMatch: false,
  sticky: false,
});

function buildFactFromTrip(
  best: FactDayTrip,
  planned: PlannedTrip,
  productionLogs: FactProductionLog[],
  sticky: boolean,
): PlanTripFact {
  if (best.id == null) return emptyFact();
  const tripId = Number(best.id);
  const log =
    productionLogs.find((l) => String(l.order_mixer_id) === String(best.id)) || null;

  const loadStart =
    isoToHhMm(best.loading_started_at || best.loadingStartedAt) ||
    isoToHhMm(log?.start_time) ||
    null;
  const release = isoToHhMm(log?.end_time) || null;
  const factPlanTime = formatTimeHHMM(String(best.time || '')) || null;

  return {
    matchedTripId: Number.isFinite(tripId) && tripId > 0 ? tripId : null,
    factStatus: String(best.status || 'Загрузка'),
    factLoadStart: loadStart,
    factRelease: release,
    factPlanTime,
    factVolume: Number(best.volume) || null,
    deltaLoadMin: deltaMinutes(planned.loadTime, loadStart),
    deltaReleaseMin: deltaMinutes(planned.loadTime, release),
    noOperatorRecord: Boolean(log?.no_operator_record),
    hasMatch: true,
    sticky,
  };
}

/**
 * Сопоставить плановый рейс с live dayTrips + production_logs.
 * usedTripIds — уже занятые матчи (чтобы два плановых слота не схватили один live).
 */
export function matchPlanTripToFact(
  planned: PlannedTrip,
  dayTrips: FactDayTrip[],
  productionLogs: FactProductionLog[],
  usedTripIds?: Set<string>,
): PlanTripFact {
  const oid = String(planned.orderId);
  const isPu = Boolean(planned.pickup || planned.mixerNumber === PICKUP_MIXER_NUMBER);
  const planLoad = planned.loadTime;
  const planLoadMin = planned.loadAtMin ?? parsePlanMinutes(planLoad);

  const candidates = dayTrips.filter((t) => {
    if (String(t.orderId ?? t.order_id) !== oid) return false;
    const id = t.id != null ? String(t.id) : '';
    if (id && usedTripIds?.has(id)) return false;
    return true;
  });

  if (candidates.length === 0) return emptyFact();

  // 1) Жёсткая 1:1 по сохранённому order_mixers.id
  if (planned.orderMixerId != null && Number(planned.orderMixerId) > 0) {
    const stickyId = String(planned.orderMixerId);
    const byId = candidates.find((t) => t.id != null && String(t.id) === stickyId);
    if (byId) {
      if (usedTripIds) usedTripIds.add(stickyId);
      return buildFactFromTrip(byId, planned, productionLogs, true);
    }
  }

  let best: FactDayTrip | null = null;

  if (isPu) {
    const scored = candidates
      .map((t) => ({ t, score: scoreCandidate(t, planned, planLoadMin) }))
      .sort((a, b) => a.score - b.score);
    // Самовывоз: только уникальный близкий кандидат
    const top = scored[0];
    const second = scored[1];
    if (
      top &&
      (!second || second.score - top.score >= 8) &&
      Math.abs((Number(top.t.volume) || 0) - (Number(planned.volume) || 0)) <= 0.15
    ) {
      best = top.t;
    }
  } else {
    const key = normalizeMixerKey(planned.mixerNumber);
    const sameMixer = candidates.filter(
      (t) => normalizeMixerKey(String(t.number || t.mixer_name || '')) === key,
    );

    if (sameMixer.length === 1) {
      // Один кандидат с тем же номером — ок даже без идеального времени.
      best = sameMixer[0];
    } else if (sameMixer.length > 1) {
      // Несколько рейсов одного миксера: окно по абсолютному времени (в т.ч. +Nд).
      const scored = sameMixer
        .map((t) => {
          const tMin = parseClockMinutes(String(t.time || ''));
          const timeDiff = timeDiffAcrossDays(planLoadMin, tMin);
          const volDiff = Math.abs(
            (Number(t.volume) || 0) - (Number(planned.volume) || 0),
          );
          return { t, timeDiff, volDiff };
        })
        .filter((x) => x.timeDiff <= 45 && x.volDiff <= 0.2)
        .sort(
          (a, b) =>
            a.timeDiff - b.timeDiff || a.volDiff - b.volDiff,
        );
      if (scored[0]) {
        const gap = scored[1]
          ? scored[1].timeDiff - scored[0].timeDiff
          : Infinity;
        // Однозначность: большой зазор ИЛИ явный ближайший (≤5 мин и хотя бы +1 мин от второго)
        const unambiguous =
          !scored[1] ||
          gap >= 12 ||
          (scored[0].timeDiff <= 5 && gap >= 1);
        if (unambiguous) best = scored[0].t;
      }
    } else {
      // Без совпадения номера — только если ровно один кандидат близко по объёму/времени
      const close = candidates.filter((t) => {
        const volDiff = Math.abs((Number(t.volume) || 0) - (Number(planned.volume) || 0));
        if (volDiff > 0.15) return false;
        if (planLoadMin == null) return true;
        const tMin = parseClockMinutes(String(t.time || ''));
        return timeDiffAcrossDays(planLoadMin, tMin) <= 20;
      });
      if (close.length === 1) best = close[0];
    }
  }

  if (!best || best.id == null) return emptyFact();
  if (usedTripIds) usedTripIds.add(String(best.id));
  return buildFactFromTrip(best, planned, productionLogs, false);
}

/** Матч всех плановых рейсов дня (без двойного захвата одного live). */
export function matchAllPlanTripsToFact(
  plannedTrips: PlannedTrip[],
  dayTrips: FactDayTrip[],
  productionLogs: FactProductionLog[],
): Map<string, PlanTripFact> {
  const used = new Set<string>();
  const sorted = [...plannedTrips].sort((a, b) => {
    // Сначала sticky — чтобы не перехватили fuzzy
    const as = a.orderMixerId != null ? 0 : 1;
    const bs = b.orderMixerId != null ? 0 : 1;
    if (as !== bs) return as - bs;
    const am = a.loadAtMin ?? parsePlanMinutes(a.loadTime) ?? 0;
    const bm = b.loadAtMin ?? parsePlanMinutes(b.loadTime) ?? 0;
    return am - bm;
  });
  const map = new Map<string, PlanTripFact>();
  for (const t of sorted) {
    map.set(t.id, matchPlanTripToFact(t, dayTrips, productionLogs, used));
  }
  return map;
}

/** Live-рейс уже «выпущен» с БСУ — этап не должен его перетирать. */
export function liveTripHasReleaseFact(
  trip: FactDayTrip,
  productionLogs: FactProductionLog[],
): boolean {
  const st = String(trip.status || '');
  if ((PLANNER_FACT_SHIPPED_STATUSES as readonly string[]).includes(st)) return true;
  if (st === 'Загрузка' && (trip.loading_started_at || trip.loadingStartedAt)) return true;
  const log = productionLogs.find((l) => String(l.order_mixer_id) === String(trip.id));
  return Boolean(log?.end_time);
}
