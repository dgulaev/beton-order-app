/**
 * V2: калибровка норм интеллекта по истории план↔факт.
 * Мягкие пределы — не уводим константы в ноль.
 * Без импорта logisticsPlanner (чтобы не было цикла).
 */

export const PLANNER_LEARN_DAYS = 45;
/** Минимум matched-рейсов с валидной длительностью загрузки, чтобы включить calib load. */
export const PLANNER_CALIB_MIN_SAMPLES = 12;

const DEFAULT_LOAD_SLOT = 15;
const DEFAULT_UNLOAD = 35;
const DEFAULT_JOIN = 5;

export type VolumeBucket = 'le8' | 'le10' | 'gt10';

export type PlannerCalibration = {
  /** P50 загрузки по объёму бочки, мин */
  loadByBucket: Partial<Record<VolumeBucket, number>>;
  /** Общий P50 загрузки (fallback), мин */
  loadP50: number | null;
  /** Множитель к базе дороги (не-пик / пик) */
  roadFactorOffpeak: number | null;
  roadFactorPeak: number | null;
  /** P50 разгрузки на объекте, мин */
  unloadP50: number | null;
  /** P50 стыка рейсов, мин */
  joinBufferP50: number | null;
  samples: number;
  daysUsed: number;
  updatedAt: string | null;
};

export const EMPTY_CALIBRATION: PlannerCalibration = {
  loadByBucket: {},
  loadP50: null,
  roadFactorOffpeak: null,
  roadFactorPeak: null,
  unloadP50: null,
  joinBufferP50: null,
  samples: 0,
  daysUsed: 0,
  updatedAt: null,
};

export function volumeBucket(volumeM3: number): VolumeBucket {
  const v = Number(volumeM3) || 0;
  if (v <= 8) return 'le8';
  if (v <= 10) return 'le10';
  return 'gt10';
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** Перцентиль 0..100 по отсортированной копии. */
export function percentile(sortedAsc: number[], p: number): number | null {
  if (!sortedAsc.length) return null;
  if (sortedAsc.length === 1) return sortedAsc[0];
  const rank = clamp(p, 0, 100) / 100;
  const idx = (sortedAsc.length - 1) * rank;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedAsc[lo];
  const w = idx - lo;
  return sortedAsc[lo] * (1 - w) + sortedAsc[hi] * w;
}

/** Отсечь выбросы по IQR, затем P50. */
export function robustP50(values: number[]): number | null {
  const clean = values.filter((v) => Number.isFinite(v));
  if (clean.length < 3) {
    const s = [...clean].sort((a, b) => a - b);
    return percentile(s, 50);
  }
  const s = [...clean].sort((a, b) => a - b);
  const q1 = percentile(s, 25)!;
  const q3 = percentile(s, 75)!;
  const iqr = Math.max(0, q3 - q1);
  const lo = q1 - 1.5 * iqr;
  const hi = q3 + 1.5 * iqr;
  const filtered = s.filter((v) => v >= lo && v <= hi);
  const use = filtered.length >= 3 ? filtered : s;
  const p50 = percentile(use, 50);
  return p50 == null ? null : Math.round(p50 * 10) / 10;
}

export function parseCalibrationPayload(raw: unknown): PlannerCalibration {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_CALIBRATION };
  const o = raw as Record<string, unknown>;
  const buckets = (o.loadByBucket && typeof o.loadByBucket === 'object'
    ? o.loadByBucket
    : {}) as Record<string, unknown>;
  const loadByBucket: Partial<Record<VolumeBucket, number>> = {};
  for (const key of ['le8', 'le10', 'gt10'] as VolumeBucket[]) {
    const n = Number(buckets[key]);
    if (Number.isFinite(n) && n > 0) loadByBucket[key] = n;
  }
  return {
    loadByBucket,
    loadP50: Number.isFinite(Number(o.loadP50)) ? Number(o.loadP50) : null,
    roadFactorOffpeak: Number.isFinite(Number(o.roadFactorOffpeak))
      ? Number(o.roadFactorOffpeak)
      : null,
    roadFactorPeak: Number.isFinite(Number(o.roadFactorPeak))
      ? Number(o.roadFactorPeak)
      : null,
    unloadP50: Number.isFinite(Number(o.unloadP50)) ? Number(o.unloadP50) : null,
    joinBufferP50: Number.isFinite(Number(o.joinBufferP50))
      ? Number(o.joinBufferP50)
      : null,
    samples: Math.max(0, Math.round(Number(o.samples) || 0)),
    daysUsed: Math.max(0, Math.round(Number(o.daysUsed) || 0)),
    updatedAt: o.updatedAt != null ? String(o.updatedAt) : null,
  };
}

function defaultLoadMinutes(volumeM3: number): number {
  const v = Math.max(0, Number(volumeM3) || 0);
  if (v <= 0) return DEFAULT_LOAD_SLOT;
  return Math.max(12, Math.min(18, Math.round(10 + v * 0.5)));
}

export function resolveLoadMinutes(
  volumeM3: number,
  calib?: PlannerCalibration | null,
): number {
  const fallback = defaultLoadMinutes(volumeM3);
  if (!calib || calib.samples < PLANNER_CALIB_MIN_SAMPLES) return fallback;
  const bucket = volumeBucket(volumeM3);
  const fromBucket = calib.loadByBucket[bucket];
  const raw = fromBucket ?? calib.loadP50;
  if (raw == null || !(raw > 0)) return fallback;
  return Math.round(clamp(raw, 8, 18));
}

export function resolveUnloadMinutes(calib?: PlannerCalibration | null): number {
  if (!calib || calib.samples < PLANNER_CALIB_MIN_SAMPLES) return DEFAULT_UNLOAD;
  if (calib.unloadP50 == null || !(calib.unloadP50 > 0)) return DEFAULT_UNLOAD;
  return Math.round(clamp(calib.unloadP50, 20, 45));
}

export function resolveJoinBufferMinutes(calib?: PlannerCalibration | null): number {
  if (!calib || calib.samples < PLANNER_CALIB_MIN_SAMPLES) return DEFAULT_JOIN;
  if (calib.joinBufferP50 == null || !(calib.joinBufferP50 > 0)) {
    return DEFAULT_JOIN;
  }
  return Math.round(clamp(calib.joinBufferP50, 3, 10));
}

/**
 * Множитель к уже посчитанной дороге (после пробок).
 * isPeak — час пик по матрице трафика.
 */
export function applyRoadCalibrationFactor(
  roadMin: number,
  isPeak: boolean,
  calib?: PlannerCalibration | null,
): number {
  const base = Math.max(5, Number(roadMin) || 5);
  if (!calib || calib.samples < PLANNER_CALIB_MIN_SAMPLES) return base;
  const factor = isPeak
    ? calib.roadFactorPeak ?? calib.roadFactorOffpeak
    : calib.roadFactorOffpeak ?? calib.roadFactorPeak;
  if (factor == null || !(factor > 0)) return base;
  return Math.max(5, Math.round(base * clamp(factor, 0.75, 1.35)));
}

export function calibrationSummaryLabel(calib: PlannerCalibration | null | undefined): string {
  if (!calib || calib.samples < PLANNER_CALIB_MIN_SAMPLES) {
    return `Нормы по умолчанию (загрузка ~${DEFAULT_LOAD_SLOT} мин, разгрузка ${DEFAULT_UNLOAD} мин)`;
  }
  const load = calib.loadP50 != null ? Math.round(calib.loadP50) : DEFAULT_LOAD_SLOT;
  const unload =
    calib.unloadP50 != null ? Math.round(calib.unloadP50) : DEFAULT_UNLOAD;
  return `Нормы из истории ${calib.daysUsed} дн. · ${calib.samples} рейс. · соска ~${load} мин · разгрузка ~${unload} мин`;
}

export type CalibrationSourceMeta = {
  days: number;
  samples: number;
  loadP50: number | null;
  unloadP50: number | null;
  roadFactorOffpeak: number | null;
  roadFactorPeak: number | null;
  joinBufferP50: number | null;
  active: boolean;
};

export function toCalibrationSourceMeta(
  calib: PlannerCalibration | null | undefined,
): CalibrationSourceMeta {
  const active = Boolean(calib && calib.samples >= PLANNER_CALIB_MIN_SAMPLES);
  return {
    days: calib?.daysUsed ?? 0,
    samples: calib?.samples ?? 0,
    loadP50: calib?.loadP50 ?? null,
    unloadP50: calib?.unloadP50 ?? null,
    roadFactorOffpeak: calib?.roadFactorOffpeak ?? null,
    roadFactorPeak: calib?.roadFactorPeak ?? null,
    joinBufferP50: calib?.joinBufferP50 ?? null,
    active,
  };
}
