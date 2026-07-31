/**
 * Общий live-план дня интеллекта (Фаза 6).
 * payload в daily_logistics_plans — снимок черновика + warnings.
 */

import type {
  PlannedTrip,
  PlannerOrderShift,
  PlannerWarning,
  PlannerWave,
} from '@/lib/logisticsPlanner';

export const PLANNER_EDIT_ROLES_CLIENT = [
  'admin',
  'manager',
  'dispatcher',
] as const;

export type DailyLogisticsPlanPayload = {
  selectedMixerIds: string[];
  lockedTrips: PlannedTrip[];
  manualDoneOrderIds: string[];
  trips: PlannedTrip[];
  allowNight?: boolean;
  useTraffic?: boolean;
  orderShifts?: PlannerOrderShift[];
  warnings?: PlannerWarning[];
  /** Фаза 4: история волн дня */
  waves?: PlannerWave[];
  /** Правки вместимости миксера на день (номер → м³), напр. бочка забита 10→9 */
  mixerVolumeOverrides?: Record<string, number>;
};

export type DailyLogisticsPlanRow = {
  delivery_date: string;
  payload: DailyLogisticsPlanPayload;
  max_text: string | null;
  revision: number;
  updated_at: string;
  updated_by_name: string | null;
  updated_by_role: string | null;
  updated_by_user_id: number | null;
  editing_by_name?: string | null;
  editing_by_user_id?: number | null;
  editing_at?: string | null;
  /** V2: утренний снимок (первый full_day) */
  morning_payload?: DailyLogisticsPlanPayload | null;
  morning_captured_at?: string | null;
};

/** Heartbeat «сейчас правит» считается живым N мс (для коллег). */
export const PLAN_EDITING_FRESH_MS = 120_000;

/**
 * Не писать в БД soft-lock чаще этого окна — иначе realtime шлёт весь payload.
 * Клиент бьёт ~50 с; коллеги видят lock до PLAN_EDITING_FRESH_MS.
 */
export const PLAN_EDITING_TOUCH_MIN_MS = 55_000;

export function isPlanEditingFresh(
  editingAt: string | null | undefined,
  nowMs = Date.now(),
): boolean {
  if (!editingAt) return false;
  const t = new Date(editingAt).getTime();
  if (Number.isNaN(t)) return false;
  return nowMs - t < PLAN_EDITING_FRESH_MS;
}

/** Редактор тот же и editing_at трогали недавно — PATCH можно skip. */
export function isPlanEditingRecentlyTouched(
  editingAt: string | null | undefined,
  nowMs = Date.now(),
): boolean {
  if (!editingAt) return false;
  const t = new Date(editingAt).getTime();
  if (Number.isNaN(t)) return false;
  return nowMs - t < PLAN_EDITING_TOUCH_MIN_MS;
}

/** YYYY-M-D / YYYY-MM-DD → YYYY-MM-DD */
export function normalizePlanDateKey(raw: string): string | null {
  const s = String(raw || '').trim();
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) return null;
  const y = m[1];
  const mo = m[2].padStart(2, '0');
  const d = m[3].padStart(2, '0');
  return `${y}-${mo}-${d}`;
}

export function canEditDailyLogisticsPlan(role: string | null | undefined): boolean {
  const r = String(role || '').toLowerCase();
  return (PLANNER_EDIT_ROLES_CLIENT as readonly string[]).includes(r);
}

export function formatPlanUpdatedAtLabel(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const PLAN_DRAFT_PREFIX = 'logisticsPlan_';

/** Возможные ключи dateKey (с нулями и без) — старые черновики могли писаться по-разному. */
export function logisticsPlanDraftKeys(dateKey: string): string[] {
  const norm = normalizePlanDateKey(dateKey);
  const keys = new Set<string>();
  if (norm) keys.add(norm);
  keys.add(String(dateKey || '').trim());
  const m = String(dateKey || '').trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) {
    keys.add(`${m[1]}-${parseInt(m[2], 10)}-${parseInt(m[3], 10)}`);
  }
  return [...keys].filter(Boolean);
}

/** Черновик интеллекта из localStorage (до публикации в БД). */
export function loadLocalLogisticsPlanDraft(
  dateKey: string,
): DailyLogisticsPlanPayload | null {
  if (typeof window === 'undefined') return null;
  for (const key of logisticsPlanDraftKeys(dateKey)) {
    try {
      const raw = localStorage.getItem(`${PLAN_DRAFT_PREFIX}${key}`);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as DailyLogisticsPlanPayload;
      if (!parsed || typeof parsed !== 'object') continue;
      return {
        selectedMixerIds: Array.isArray(parsed.selectedMixerIds)
          ? parsed.selectedMixerIds.map(String)
          : [],
        lockedTrips: Array.isArray(parsed.lockedTrips) ? parsed.lockedTrips : [],
        manualDoneOrderIds: Array.isArray(parsed.manualDoneOrderIds)
          ? parsed.manualDoneOrderIds.map(String)
          : [],
        trips: Array.isArray(parsed.trips) ? parsed.trips : [],
        allowNight: Boolean(parsed.allowNight),
        useTraffic: Boolean(parsed.useTraffic),
        orderShifts: Array.isArray(parsed.orderShifts) ? parsed.orderShifts : [],
        warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
        waves: Array.isArray(parsed.waves) ? parsed.waves : [],
      };
    } catch {
      /* next key */
    }
  }
  return null;
}
