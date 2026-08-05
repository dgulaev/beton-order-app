/** Фаза 2 FMS — график ТО и сервисные записи. */

import type { LifecycleStatus } from '@/lib/fleetLifecycle';

export type ServiceRecordStatus = 'requested' | 'in_progress' | 'done';

export const SERVICE_RECORD_STATUSES: {
  value: ServiceRecordStatus;
  label: string;
  color: string;
}[] = [
  { value: 'requested', label: 'Заявка', color: '#F97316' },
  { value: 'in_progress', label: 'В работе', color: '#38BDF8' },
  { value: 'done', label: 'Выполнено', color: '#4ADE80' },
];

export function isServiceRecordStatus(v: unknown): v is ServiceRecordStatus {
  return SERVICE_RECORD_STATUSES.some((s) => s.value === v);
}

export type ServiceKind =
  | 'oil_change'
  | 'filters'
  | 'tires'
  | 'brakes'
  | 'inspection'
  | 'repair'
  | 'other';

export const SERVICE_KINDS: { value: ServiceKind; label: string }[] = [
  { value: 'oil_change', label: 'Замена масла' },
  { value: 'filters', label: 'Фильтры' },
  { value: 'tires', label: 'Шины' },
  { value: 'brakes', label: 'Тормоза' },
  { value: 'inspection', label: 'ТО / осмотр' },
  { value: 'repair', label: 'Ремонт' },
  { value: 'other', label: 'Прочее' },
];

export function isServiceKind(v: unknown): v is ServiceKind {
  return SERVICE_KINDS.some((k) => k.value === v);
}

export function serviceKindLabel(kind: string): string {
  return SERVICE_KINDS.find((k) => k.value === kind)?.label ?? kind;
}

export type ServicePart = {
  name: string;
  qty?: number;
  cost?: number;
};

export type FleetServiceSchedule = {
  id: number;
  mixer_id: number;
  service_kind: string;
  title: string | null;
  interval_km: number | null;
  interval_days: number | null;
  interval_hours: number | null;
  last_done_at: string | null;
  last_odometer: number | null;
  last_engine_hours: number | null;
  created_at: string;
};

export type FleetServiceRecord = {
  id: number;
  mixer_id: number;
  schedule_id: number | null;
  status: ServiceRecordStatus;
  service_date: string;
  odometer_km: number | null;
  description: string | null;
  parts: ServicePart[];
  labor_cost: number;
  parts_cost: number;
  performed_by: string | null;
  /** Пути в storage */
  photos: string[];
  /** Signed URL для UI (только в ответах API) */
  photoUrls?: string[];
  created_at: string;
  created_by: string | null;
};

/** Сегодня YYYY-MM-DD в Europe/Moscow (завод / Брянск). */
export function todayMoscowYmd(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** ТС, которые нельзя ставить в планировщик логистики. */
export const PLANNER_BLOCKED_LIFECYCLES: LifecycleStatus[] = [
  'repair',
  'conservation',
  'sold',
];

export function isPlannerEligibleLifecycle(status: unknown): boolean {
  if (status == null || status === '') return true;
  return !PLANNER_BLOCKED_LIFECYCLES.includes(status as LifecycleStatus);
}

/** Порог «скоро ТО»: 14 дней / 500 км / 20 моточасов. */
export const SERVICE_DUE_SOON_DAYS = 14;
export const SERVICE_DUE_SOON_KM = 500;
export const SERVICE_DUE_SOON_HOURS = 20;

export type ServiceDueInfo = {
  scheduleId: number;
  serviceKind: string;
  title: string;
  urgency: 'ok' | 'soon' | 'overdue';
  dueInDays: number | null;
  dueInKm: number | null;
  dueInHours: number | null;
  reason: string;
};

function daysBetween(fromIso: string | null, to = new Date()): number | null {
  if (!fromIso) return null;
  const from = new Date(fromIso.slice(0, 10));
  if (Number.isNaN(from.getTime())) return null;
  const today = new Date(to);
  today.setHours(0, 0, 0, 0);
  from.setHours(0, 0, 0, 0);
  return Math.ceil((from.getTime() - today.getTime()) / 86_400_000);
}

/**
 * Оценка ближайшего ТО по шаблону и текущим одометру/моточасам.
 * last_done_at + interval_days → календарь;
 * last_odometer + interval_km → пробег;
 * last_engine_hours + interval_hours → моточасы.
 */
export function computeServiceDue(
  schedule: Pick<
    FleetServiceSchedule,
    | 'id'
    | 'service_kind'
    | 'title'
    | 'interval_km'
    | 'interval_days'
    | 'interval_hours'
    | 'last_done_at'
    | 'last_odometer'
    | 'last_engine_hours'
  >,
  currentOdometer: number | null | undefined,
  currentHours: number | null | undefined,
): ServiceDueInfo | null {
  const title =
    schedule.title?.trim() ||
    serviceKindLabel(schedule.service_kind);

  let dueInDays: number | null = null;
  let dueInKm: number | null = null;
  let dueInHours: number | null = null;

  if (schedule.interval_days != null && schedule.interval_days > 0) {
    if (schedule.last_done_at) {
      const last = new Date(schedule.last_done_at);
      last.setDate(last.getDate() + Number(schedule.interval_days));
      dueInDays = daysBetween(last.toISOString());
    } else {
      // Никогда не делали — считаем просроченным по календарю
      dueInDays = -1;
    }
  }

  if (
    schedule.interval_km != null &&
    schedule.interval_km > 0 &&
    currentOdometer != null &&
    Number.isFinite(Number(currentOdometer))
  ) {
    const base = schedule.last_odometer != null ? Number(schedule.last_odometer) : 0;
    const nextAt = base + Number(schedule.interval_km);
    dueInKm = nextAt - Number(currentOdometer);
  }

  if (
    schedule.interval_hours != null &&
    schedule.interval_hours > 0 &&
    currentHours != null &&
    Number.isFinite(Number(currentHours))
  ) {
    const base = schedule.last_engine_hours != null ? Number(schedule.last_engine_hours) : 0;
    const nextAt = base + Number(schedule.interval_hours);
    dueInHours = nextAt - Number(currentHours);
  }

  if (dueInDays == null && dueInKm == null && dueInHours == null) {
    return null;
  }

  const overdue =
    (dueInDays != null && dueInDays < 0) ||
    (dueInKm != null && dueInKm < 0) ||
    (dueInHours != null && dueInHours < 0);

  const soon =
    !overdue &&
    ((dueInDays != null && dueInDays <= SERVICE_DUE_SOON_DAYS) ||
      (dueInKm != null && dueInKm <= SERVICE_DUE_SOON_KM) ||
      (dueInHours != null && dueInHours <= SERVICE_DUE_SOON_HOURS));

  const parts: string[] = [];
  if (dueInDays != null) {
    parts.push(
      dueInDays < 0
        ? `просрочено на ${Math.abs(dueInDays)} дн.`
        : `через ${dueInDays} дн.`,
    );
  }
  if (dueInKm != null) {
    parts.push(
      dueInKm < 0
        ? `просрочено на ${Math.abs(Math.round(dueInKm))} км`
        : `через ${Math.round(dueInKm)} км`,
    );
  }
  if (dueInHours != null) {
    parts.push(
      dueInHours < 0
        ? `просрочено на ${Math.abs(Math.round(dueInHours))} м/ч`
        : `через ${Math.round(dueInHours)} м/ч`,
    );
  }

  return {
    scheduleId: schedule.id,
    serviceKind: schedule.service_kind,
    title,
    urgency: overdue ? 'overdue' : soon ? 'soon' : 'ok',
    dueInDays,
    dueInKm,
    dueInHours,
    reason: parts.join(' · '),
  };
}

export function parseParts(raw: unknown): ServicePart[] {
  if (!Array.isArray(raw)) return [];
  const out: ServicePart[] = [];
  for (const p of raw) {
    if (!p || typeof p !== 'object') continue;
    const name = String((p as ServicePart).name || '').trim();
    if (!name) continue;
    const qty = (p as ServicePart).qty;
    const cost = (p as ServicePart).cost;
    const part: ServicePart = { name };
    if (qty != null && Number.isFinite(Number(qty))) part.qty = Number(qty);
    if (cost != null && Number.isFinite(Number(cost))) part.cost = Number(cost);
    out.push(part);
  }
  return out;
}

export function parsePhotos(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((p) => String(p)).filter(Boolean);
}

export function normalizeServiceRecord(row: Record<string, unknown>): FleetServiceRecord {
  return {
    id: Number(row.id),
    mixer_id: Number(row.mixer_id),
    schedule_id: row.schedule_id != null ? Number(row.schedule_id) : null,
    status: isServiceRecordStatus(row.status) ? row.status : 'done',
    service_date: String(row.service_date || '').slice(0, 10),
    odometer_km: row.odometer_km != null ? Number(row.odometer_km) : null,
    description: row.description != null ? String(row.description) : null,
    parts: parseParts(row.parts),
    labor_cost: Number(row.labor_cost) || 0,
    parts_cost: Number(row.parts_cost) || 0,
    performed_by: row.performed_by != null ? String(row.performed_by) : null,
    photos: parsePhotos(row.photos),
    created_at: String(row.created_at || ''),
    created_by: row.created_by != null ? String(row.created_by) : null,
  };
}
