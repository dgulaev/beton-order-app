/**
 * Дискретные датчики SPIK (SpicDiscreteSensorsStatisticsService).
 *
 * На вашем сервере AddStatisticsRequest принимает только плоский
 * `{ StatisticsSessionId }` — тело Session/Settings даёт HTTP 500.
 *
 * Имена датчиков в ответе часто пустые; порядок = порядок в карточке объекта
 * СКАУТ-Студии.
 *
 * Привод бочки:
 * — pto: канал ВОМ (обычно второй дискрет после зажигания шасси)
 * — separate_engine: канал/моточасы отдельного ДВС на бочке
 */

import type { DrumDriveType } from '@/lib/fleetDrumDrive';
import { todayMoscowYmd } from '@/lib/fleetService';
import { parseScoutDate } from './parseDate';
import {
  buildAndGetStatistics,
  parseIsoDurationHours,
  withScoutSession,
} from './statsCommon';

function shiftMoscowYmd(ymd: string, days: number): string {
  const base = new Date(`${ymd}T12:00:00+03:00`).getTime();
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(base + days * 86_400_000));
}

export type ScoutDiscreteSensor = {
  /** Индекс в ответе SPIK (0-based), совпадает с порядком в Студии */
  index: number;
  name: string | null;
  pointsCount: number;
  /** Часы в состоянии true за период */
  onHours: number;
  lastValue: boolean | null;
  lastAtIso: string | null;
};

export type ScoutDiscreteStats = {
  sensors: ScoutDiscreteSensor[];
  fromIso: string;
  toIso: string;
};

export type ScoutDrumHoursGuess = {
  driveType: DrumDriveType;
  /** Моточасы работы смесителя (бочки) за период */
  drumOnHours: number | null;
  /** Индекс дискретного канала */
  sensorIndex: number | null;
  /** Часы зажигания шасси по дискрету (ближайший к MotorModes) */
  ignitionOnHours: number | null;
  ignitionSensorIndex: number | null;
  confidence: 'high' | 'low' | 'none';
  note: string | null;
};

type DiscreteChunk = {
  ChunkInfo?: { ErrorText?: string | null; IsFinalChunk?: boolean; Status?: { Value?: string } };
  Statistics?: {
    Sensors?: Array<{
      SensorName?: string;
      SensorNumber?: number;
      Points?: Array<{ Timestamp?: string; Value?: boolean | number | string }>;
    }>;
  } | null;
};

function parseBool(v: unknown): boolean | null {
  if (v === true || v === 1 || v === '1' || v === 'true') return true;
  if (v === false || v === 0 || v === '0' || v === 'false') return false;
  return null;
}

function onHoursFromPoints(
  points: Array<{ Timestamp?: string; Value?: boolean | number | string }>,
  opts?: { toIso?: string },
): number {
  if (!points.length) return 0;
  const periodEndMs = opts?.toIso ? Date.parse(opts.toIso) : NaN;
  const fallbackEnd = Number.isFinite(periodEndMs) ? periodEndMs : Date.now();
  let onMs = 0;
  for (let i = 0; i < points.length; i++) {
    const t0 = points[i]?.Timestamp
      ? Date.parse(parseScoutDate(String(points[i]!.Timestamp)) || '')
      : NaN;
    const t1 =
      i + 1 < points.length && points[i + 1]?.Timestamp
        ? Date.parse(parseScoutDate(String(points[i + 1]!.Timestamp)) || '')
        : fallbackEnd;
    if (!Number.isFinite(t0) || !Number.isFinite(t1)) continue;
    if (parseBool(points[i]?.Value) === true) onMs += Math.max(0, t1 - t0);
  }
  return Math.round((onMs / 3_600_000) * 100) / 100;
}

function emptyGuess(driveType: DrumDriveType, note: string | null = null): ScoutDrumHoursGuess {
  return {
    driveType,
    drumOnHours: null,
    sensorIndex: null,
    ignitionOnHours: null,
    ignitionSensorIndex: null,
    confidence: 'none',
    note,
  };
}

function findClosestToEngine(
  sensors: ScoutDiscreteSensor[],
  eng: number,
): { sensor: ScoutDiscreteSensor; relErr: number } | null {
  let best: ScoutDiscreteSensor | null = null;
  let bestAbs = Infinity;
  for (const s of sensors) {
    if (s.onHours < 0.05) continue;
    const d = Math.abs(s.onHours - eng);
    if (d < bestAbs) {
      bestAbs = d;
      best = s;
    }
  }
  if (!best) return null;
  return { sensor: best, relErr: bestAbs / Math.max(eng, 0.01) };
}

export async function scoutFetchDiscreteSensors(opts: {
  unitId: number;
  fromIso: string;
  toIso: string;
}): Promise<ScoutDiscreteStats> {
  return withScoutSession(async (config, sid) => {
    const chunk = await buildAndGetStatistics<DiscreteChunk>(config, sid, {
      unitId: opts.unitId,
      fromIso: opts.fromIso,
      toIso: opts.toIso,
      servicePath: 'DiscreteSensor',
      addMode: 'flat',
      polls: 16,
      pollDelayMs: 800,
    });

    const sensors: ScoutDiscreteSensor[] = [];
    (chunk.Statistics?.Sensors ?? []).forEach((s, arrayIndex) => {
      const pts = s.Points ?? [];
      let lastValue: boolean | null = null;
      let lastAtIso: string | null = null;
      for (let i = pts.length - 1; i >= 0; i--) {
        const b = parseBool(pts[i]?.Value);
        if (b != null) {
          lastValue = b;
          lastAtIso = pts[i]?.Timestamp ? parseScoutDate(String(pts[i]!.Timestamp)) : null;
          break;
        }
      }
      const name = String(s.SensorName || '').trim() || null;
      const sensorNumber =
        s.SensorNumber != null && Number.isFinite(Number(s.SensorNumber))
          ? Number(s.SensorNumber)
          : arrayIndex;
      sensors.push({
        index: sensorNumber,
        name,
        pointsCount: pts.length,
        onHours: onHoursFromPoints(pts, { toIso: opts.toIso }),
        lastValue,
        lastAtIso,
      });
    });

    return { sensors, fromIso: opts.fromIso, toIso: opts.toIso };
  });
}

export type ScoutDiscreteStatsWindow = ScoutDiscreteStats & {
  fromYmd: string;
  toYmd: string;
  windowDays: number;
};

/**
 * DiscreteSensor за длинный период (YTD) на вашем сервере часто отдаёт
 * каналы без Points. Берём короткое окно: 7 → 30 → 90 суток.
 */
export async function scoutFetchDiscreteSensorsWithFallback(opts: {
  unitId: number;
  toYmd?: string;
  windowsDays?: number[];
}): Promise<ScoutDiscreteStatsWindow> {
  const toYmd = opts.toYmd || todayMoscowYmd();
  const windows = opts.windowsDays?.length ? opts.windowsDays : [7, 30, 90];
  let last: ScoutDiscreteStatsWindow | null = null;

  for (const days of windows) {
    const fromYmd = shiftMoscowYmd(toYmd, -(days - 1));
    const stats = await scoutFetchDiscreteSensors({
      unitId: opts.unitId,
      fromIso: `${fromYmd}T00:00:00+03:00`,
      toIso: `${toYmd}T23:59:59.999+03:00`,
    });
    const row: ScoutDiscreteStatsWindow = {
      ...stats,
      fromYmd,
      toYmd,
      windowDays: days,
    };
    last = row;
    if (stats.sensors.some((s) => s.pointsCount > 0)) return row;
  }

  return (
    last ?? {
      sensors: [],
      fromIso: `${toYmd}T00:00:00+03:00`,
      toIso: `${toYmd}T23:59:59.999+03:00`,
      fromYmd: toYmd,
      toYmd,
      windowDays: windows[0] ?? 7,
    }
  );
}

/**
 * Оценка моточасов бочки (смесителя) по дискретам.
 * Только для миксеров — на другой технике бочки смесителя нет.
 */
export function guessMixerDrumHours(opts: {
  sensors: ScoutDiscreteSensor[];
  /** MotorModes.EngineOnHours — якорь двигателя шасси */
  engineOnHours: number | null;
  driveType?: DrumDriveType;
  /** Явный индекс из specs.scout_drum_sensor_index */
  preferredSensorIndex?: number | null;
}): ScoutDrumHoursGuess {
  const driveType: DrumDriveType = opts.driveType ?? 'pto';
  const sensors = opts.sensors.filter((s) => s.pointsCount > 0);
  if (!sensors.length) {
    return emptyGuess(driveType, 'Нет данных DiscreteSensor за период');
  }

  if (opts.preferredSensorIndex != null && Number.isFinite(opts.preferredSensorIndex)) {
    const pref = sensors.find((s) => s.index === opts.preferredSensorIndex);
    if (pref) {
      const eng = opts.engineOnHours;
      const ign =
        eng != null ? findClosestToEngine(sensors, eng)?.sensor ?? null : null;
      return {
        driveType,
        drumOnHours: pref.onHours,
        sensorIndex: pref.index,
        ignitionOnHours: ign?.onHours ?? null,
        ignitionSensorIndex: ign?.index ?? null,
        confidence: 'high',
        note: `Канал #${pref.index} из паспорта (scout_drum_sensor_index)`,
      };
    }
  }

  const nameRe =
    driveType === 'separate_engine'
      ? /бочка|смесит|барабан|миксер|drum|barrel|aux|доп|отдельн/i
      : /бочка|смесит|барабан|миксер|drum|barrel|mixer|pto|вом|отбор|вращ/i;
  const byName = sensors.find((s) => nameRe.test(s.name || ''));
  if (byName) {
    return {
      driveType,
      drumOnHours: byName.onHours,
      sensorIndex: byName.index,
      ignitionOnHours: null,
      ignitionSensorIndex: null,
      confidence: 'high',
      note: `По имени датчика: «${byName.name}»`,
    };
  }

  const eng =
    opts.engineOnHours != null && Number.isFinite(opts.engineOnHours)
      ? opts.engineOnHours
      : null;

  if (driveType === 'separate_engine') {
    return guessSeparateEngine(sensors, eng);
  }
  return guessPto(sensors, eng);
}

/** ВОМ: бочка = дискрет, отличный от зажигания шасси; обычно меньше моточасов шасси. */
function guessPto(
  sensors: ScoutDiscreteSensor[],
  eng: number | null,
): ScoutDrumHoursGuess {
  const driveType: DrumDriveType = 'pto';
  let ign = sensors[0]!;
  if (eng != null) {
    const closest = findClosestToEngine(sensors, eng);
    if (closest) ign = closest.sensor;
  }

  const candidates = sensors
    .filter((s) => s.index !== ign.index && s.onHours >= 0.5)
    .sort((a, b) => b.onHours - a.onHours);

  if (!candidates.length) {
    return {
      ...emptyGuess(
        driveType,
        'ВОМ: отдельный канал бочки не найден (только зажигание/один дискрет). Укажи scout_drum_sensor_index в паспорте.',
      ),
      ignitionOnHours: ign.onHours,
      ignitionSensorIndex: ign.index,
    };
  }

  const drum = candidates[0]!;
  const base = Math.max(ign.onHours, eng ?? 0, 0.01);
  const relDiff = Math.abs(drum.onHours - ign.onHours) / base;
  if (relDiff < 0.15) {
    return {
      ...emptyGuess(
        driveType,
        'ВОМ: каналы почти совпадают с двигателем шасси — укажи индекс датчика ВОМ в паспорте',
      ),
      ignitionOnHours: ign.onHours,
      ignitionSensorIndex: ign.index,
    };
  }

  return {
    driveType,
    drumOnHours: drum.onHours,
    sensorIndex: drum.index,
    ignitionOnHours: ign.onHours,
    ignitionSensorIndex: ign.index,
    confidence: relDiff >= 0.35 ? 'high' : 'low',
    note: `ВОМ: дискрет #${drum.index} (шасси ≈ #${ign.index}${eng != null ? `, MotorModes ${eng} ч` : ''})`,
  };
}

/**
 * Отдельный ДВС бочки: MotorModes ≈ шасси; моточасы бочки — канал,
 * который не совпадает с MotorModes (часто больше/меньше независимо).
 */
function guessSeparateEngine(
  sensors: ScoutDiscreteSensor[],
  eng: number | null,
): ScoutDrumHoursGuess {
  const driveType: DrumDriveType = 'separate_engine';
  const significant = sensors.filter((s) => s.onHours >= 0.5).sort((a, b) => b.onHours - a.onHours);

  if (!significant.length) {
    return emptyGuess(driveType, 'Отдельный ДВС: нет активных дискретов за период');
  }

  // MotorModes сильно меньше max(дискрет) → дискреты тянут на ДВС бочки
  if (eng != null && eng >= 0) {
    const maxDisc = significant[0]!;
    const ratio = Math.abs(maxDisc.onHours - eng) / Math.max(maxDisc.onHours, eng, 0.01);
    if (ratio >= 0.25 && maxDisc.onHours > eng) {
      const ign = findClosestToEngine(sensors, eng);
      return {
        driveType,
        drumOnHours: maxDisc.onHours,
        sensorIndex: maxDisc.index,
        ignitionOnHours: ign?.sensor.onHours ?? eng,
        ignitionSensorIndex: ign?.sensor.index ?? null,
        confidence: 'high',
        note: `Отд. ДВС бочки: дискрет #${maxDisc.index} (${maxDisc.onHours} ч) ≠ MotorModes шасси (${eng} ч)`,
      };
    }
  }

  const ignHit = eng != null ? findClosestToEngine(sensors, eng) : null;
  const ignOk = ignHit && ignHit.relErr <= 0.25 ? ignHit.sensor : null;

  if (ignOk) {
    // канал, дальше всего от MotorModes / зажигания шасси
    let drum: ScoutDiscreteSensor | null = null;
    let bestScore = -1;
    for (const s of significant) {
      if (s.index === ignOk.index) continue;
      const score = eng != null ? Math.abs(s.onHours - eng) : s.onHours;
      if (score > bestScore) {
        bestScore = score;
        drum = s;
      }
    }
    if (drum) {
      const base = Math.max(ignOk.onHours, eng ?? 0, 0.01);
      const relDiff = Math.abs(drum.onHours - ignOk.onHours) / base;
      return {
        driveType,
        drumOnHours: drum.onHours,
        sensorIndex: drum.index,
        ignitionOnHours: ignOk.onHours,
        ignitionSensorIndex: ignOk.index,
        confidence: relDiff >= 0.2 ? 'high' : 'low',
        note:
          relDiff >= 0.2
            ? `Отд. ДВС бочки: дискрет #${drum.index} (шасси ≈ #${ignOk.index})`
            : `Отд. ДВС: #${drum.index} почти как шасси — лучше задать scout_drum_sensor_index в Студии`,
      };
    }
  }

  // Один активный канал и он не похож на MotorModes → считаем его ДВС бочки
  if (significant.length === 1 && eng != null) {
    const only = significant[0]!;
    const rel = Math.abs(only.onHours - eng) / Math.max(eng, 0.01);
    if (rel >= 0.2) {
      return {
        driveType,
        drumOnHours: only.onHours,
        sensorIndex: only.index,
        ignitionOnHours: eng,
        ignitionSensorIndex: null,
        confidence: 'low',
        note: `Отд. ДВС: единственный дискрет #${only.index}; шасси по MotorModes`,
      };
    }
  }

  return emptyGuess(
    driveType,
    'Отд. ДВС: не удалось отделить канал бочки от шасси. Укажи scout_drum_sensor_index (номер дискрета в СКАУТ-Студии).',
  );
}

/** Утилита: часы из ISO duration MotorModes (реэкспорт удобства). */
export { parseIsoDurationHours };
