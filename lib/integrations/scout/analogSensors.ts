import { parseScoutDate } from './parseDate';
import { buildAndGetStatistics, withScoutSession } from './statsCommon';

export type ScoutAnalogSensor = {
  name: string;
  number: number;
  pointsCount: number;
  lastValue: number | null;
  lastAtIso: string | null;
  kind: 'fuel' | 'voltage' | 'temp' | 'odometer_like' | 'other';
};

export type ScoutAnalogStats = {
  sensors: ScoutAnalogSensor[];
  fuelLevelL: number | null;
  fromIso: string;
  toIso: string;
};

type AnalogChunk = {
  ChunkInfo?: { ErrorText?: string | null; IsFinalChunk?: boolean; Status?: { Value?: string } };
  Statistics?: {
    Sensors?: Array<{
      SensorName?: string;
      SensorNumber?: number;
      Points?: Array<{ Timestamp?: string; Value?: number | string | boolean }>;
    }>;
  } | null;
};

function classify(name: string, _last: number | null): ScoutAnalogSensor['kind'] {
  const n = name.toLowerCase();
  if (/топлив|fuel|уровнемер|lls|scoutnet/.test(n)) return 'fuel';
  if (/напряж|питан|volt|аккумулятор/.test(n)) return 'voltage';
  if (/темп|temp/.test(n)) return 'temp';
  // только по имени — безэименные крупные значения часто = мВ питания, не км
  if (/одометр|пробег|навигац|mileage|odometer/i.test(n)) return 'odometer_like';
  return 'other';
}

export async function scoutFetchAnalogSensors(opts: {
  unitId: number;
  fromIso: string;
  toIso: string;
}): Promise<ScoutAnalogStats> {
  return withScoutSession(async (config, sid) => {
    const chunk = await buildAndGetStatistics<AnalogChunk>(config, sid, {
      unitId: opts.unitId,
      fromIso: opts.fromIso,
      toIso: opts.toIso,
      servicePath: 'AnalogSensor',
      addMode: 'sessionNullSensors',
      polls: 14,
      pollDelayMs: 900,
    });

    const sensors: ScoutAnalogSensor[] = [];
    for (const s of chunk.Statistics?.Sensors ?? []) {
      const pts = s.Points ?? [];
      let lastValue: number | null = null;
      let lastAtIso: string | null = null;
      for (let i = pts.length - 1; i >= 0; i--) {
        const v = Number(pts[i]?.Value);
        if (Number.isFinite(v)) {
          lastValue = Math.round(v * 1000) / 1000;
          lastAtIso = pts[i]?.Timestamp ? parseScoutDate(String(pts[i]!.Timestamp)) : null;
          break;
        }
      }
      const name = String(s.SensorName || '');
      sensors.push({
        name: name || `Датчик ${s.SensorNumber ?? '?'}`,
        number: Number(s.SensorNumber) || 0,
        pointsCount: pts.length,
        lastValue,
        lastAtIso,
        kind: classify(name, lastValue),
      });
    }

    const fuelCandidates = sensors.filter(
      (s) => s.kind === 'fuel' && s.lastValue != null && s.lastValue > 0 && s.lastValue < 2000,
    );
    fuelCandidates.sort((a, b) => (b.lastValue ?? 0) - (a.lastValue ?? 0));
    const fuelLevelL = fuelCandidates[0]?.lastValue ?? null;

    return {
      sensors: sensors.filter((s) => s.pointsCount > 0),
      fuelLevelL,
      fromIso: opts.fromIso,
      toIso: opts.toIso,
    };
  });
}
