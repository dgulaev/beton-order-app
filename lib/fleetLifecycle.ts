/** Фаза 1 FMS — lifecycle, документы, напоминания, телематика. */

export type LifecycleStatus =
  | 'active'
  | 'repair'
  | 'conservation'
  | 'sold'
  | 'rented_out';

export const LIFECYCLE_STATUSES: {
  value: LifecycleStatus;
  label: string;
  color: string;
  bg: string;
}[] = [
  { value: 'active', label: 'В работе', color: '#4ADE80', bg: 'rgba(74,222,128,0.15)' },
  { value: 'repair', label: 'На ремонте', color: '#F97316', bg: 'rgba(249,115,22,0.15)' },
  { value: 'conservation', label: 'Консервация', color: '#94A3B8', bg: 'rgba(148,163,184,0.15)' },
  { value: 'sold', label: 'Продан', color: '#64748B', bg: 'rgba(100,116,139,0.15)' },
  { value: 'rented_out', label: 'Сдан в аренду', color: '#A78BFA', bg: 'rgba(167,139,250,0.15)' },
];

export function isLifecycleStatus(v: unknown): v is LifecycleStatus {
  return LIFECYCLE_STATUSES.some((s) => s.value === v);
}

export function lifecycleMeta(status: unknown) {
  return LIFECYCLE_STATUSES.find((s) => s.value === status) ?? LIFECYCLE_STATUSES[0];
}

export type FleetDocType = 'sts' | 'osago' | 'kasko' | 'inspection' | 'lease' | 'other';

export const FLEET_DOC_TYPES: { value: FleetDocType; label: string }[] = [
  { value: 'sts', label: 'СТС' },
  { value: 'osago', label: 'ОСАГО' },
  { value: 'kasko', label: 'КАСКО' },
  { value: 'inspection', label: 'Техосмотр' },
  { value: 'lease', label: 'Договор аренды' },
  { value: 'other', label: 'Прочее' },
];

export function isFleetDocType(v: unknown): v is FleetDocType {
  return FLEET_DOC_TYPES.some((d) => d.value === v);
}

export type FleetReminderKind = 'document_expiry' | 'service_due' | 'custom';
export type FleetReminderStatus = 'pending' | 'done' | 'dismissed';

export type FleetDocument = {
  id: number;
  mixer_id: number;
  doc_type: FleetDocType;
  title: string | null;
  file_name: string;
  storage_path: string;
  mime_type: string | null;
  size_bytes: number | null;
  expires_at: string | null;
  created_at: string;
  created_by: string | null;
};

export type FleetReminder = {
  id: number;
  mixer_id: number;
  kind: FleetReminderKind;
  title: string;
  due_date: string | null;
  due_odometer: number | null;
  status: FleetReminderStatus;
  created_at: string;
};

export type FleetTelemetrySnapshot = {
  id: number;
  mixer_id: number;
  scout_unit_id: number | null;
  lat: number | null;
  lon: number | null;
  speed_kmh: number | null;
  address: string | null;
  last_message_at: string | null;
  is_online: boolean;
  raw: Record<string, unknown> | null;
  updated_at: string;
};

/** Паспортные поля в mixers.specs (Фаза 1). */
export type FleetPassportSpecs = {
  vin?: string;
  year?: number | string;
  photo_url?: string;
  fuel_type?: string;
  tank_volume_l?: number | string;
};

export const FUEL_TYPE_OPTIONS = [
  { value: 'diesel', label: 'Дизель' },
  { value: 'gasoline', label: 'Бензин' },
  { value: 'gas', label: 'Газ' },
  { value: 'electric', label: 'Электро' },
];

export const FLEET_DOCUMENTS_BUCKET = 'fleet-documents';
export const FLEET_DOCUMENT_MAX_BYTES = 20 * 1024 * 1024;

const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

const EXT_TO_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

/** MIME из расширения, если браузер прислал пустой type. */
export function inferFleetDocumentMime(fileName?: string | null): string | null {
  if (!fileName) return null;
  const ext = fileName.split('.').pop()?.toLowerCase();
  if (!ext) return null;
  return EXT_TO_MIME[ext] ?? null;
}

export function resolveFleetDocumentMime(file: { type?: string; name?: string }): string | null {
  if (file.type && ALLOWED_MIME.has(file.type)) return file.type;
  const inferred = inferFleetDocumentMime(file.name);
  if (inferred && ALLOWED_MIME.has(inferred)) return inferred;
  return null;
}

export function isAllowedFleetDocument(file: { type?: string; size?: number; name?: string }): string | null {
  if (file.size != null && file.size > FLEET_DOCUMENT_MAX_BYTES) {
    return 'Файл больше 20 МБ';
  }
  if (!resolveFleetDocumentMime(file)) {
    return 'Допустимы PDF, JPEG, PNG, WebP';
  }
  return null;
}

export function isFleetReminderKind(v: unknown): v is FleetReminderKind {
  return v === 'document_expiry' || v === 'service_due' || v === 'custom';
}

export function isFleetReminderStatus(v: unknown): v is FleetReminderStatus {
  return v === 'pending' || v === 'done' || v === 'dismissed';
}

/** Выбрать более свежий snapshot (по updated_at, затем last_message_at). */
export function pickFresherTelemetry(
  a: FleetTelemetrySnapshot | null | undefined,
  b: FleetTelemetrySnapshot | null | undefined,
): FleetTelemetrySnapshot | null {
  if (!a) return b ?? null;
  if (!b) return a;
  const aAt = a.updated_at || a.last_message_at || '';
  const bAt = b.updated_at || b.last_message_at || '';
  return aAt >= bAt ? a : b;
}

/** Слить HTTP-снимок с локальной картой без отката свежих realtime-точек. */
export function mergeTelemetryIntoMap(
  prev: Map<number, FleetTelemetrySnapshot>,
  rows: FleetTelemetrySnapshot[],
): Map<number, FleetTelemetrySnapshot> {
  const next = new Map(prev);
  for (const row of rows) {
    const old = next.get(row.mixer_id);
    const fresher = pickFresherTelemetry(old, row);
    if (fresher) next.set(row.mixer_id, fresher);
  }
  return next;
}

/** Offline если нет сигнала >15 мин (MVP СКАУТ). */
export const SCOUT_OFFLINE_THRESHOLD_MIN = 15;

export function scoutIsOnline(lastMessageAt: string | null | undefined): boolean {
  if (!lastMessageAt) return false;
  const ms = Date.now() - new Date(lastMessageAt).getTime();
  return ms <= SCOUT_OFFLINE_THRESHOLD_MIN * 60_000;
}

/** Алерт если offline >24 ч. */
export function scoutIsStale(lastMessageAt: string | null | undefined): boolean {
  if (!lastMessageAt) return true;
  const ms = Date.now() - new Date(lastMessageAt).getTime();
  return ms > 24 * 60 * 60_000;
}

/**
 * Нормализация госномера для сопоставления с Name в СКАУТ.
 * Латинские lookalike → кириллица (A/А, B/В, …), чтобы не ломать автомаппинг.
 */
const PLATE_LAT_TO_CYR: Record<string, string> = {
  A: 'А',
  B: 'В',
  C: 'С',
  E: 'Е',
  H: 'Н',
  K: 'К',
  M: 'М',
  O: 'О',
  P: 'Р',
  T: 'Т',
  X: 'Х',
  Y: 'У',
};

export function normalizePlate(s: string): string {
  const cleaned = s.replace(/\s+/g, '').toUpperCase().replace(/[^A-ZА-Я0-9]/gi, '');
  return cleaned.replace(/[A-Z]/g, (ch) => PLATE_LAT_TO_CYR[ch] ?? ch);
}
