import { parseScoutDate } from './parseDate';
import { buildAndGetStatistics, withScoutSession } from './statsCommon';

export type ScoutTrackPeriodRow = {
  type: string;
  beginIso: string | null;
  endIso: string | null;
  durationHours: number | null;
};

export type ScoutTrackPeriodsStats = {
  movementCount: number;
  parkingCount: number;
  idleCount: number;
  breakCount: number;
  otherCount: number;
  periods: ScoutTrackPeriodRow[];
  fromIso: string;
  toIso: string;
};

type TrackChunk = {
  ChunkInfo?: { ErrorText?: string | null; IsFinalChunk?: boolean; Status?: { Value?: string } };
  Statistics?: {
    Periods?: Array<{
      Type?: { Value?: string } | string;
      Period?: { Begin?: string; End?: string };
    }>;
    Recoils?: unknown[];
  } | null;
};

function typeValue(raw: unknown): string {
  if (typeof raw === 'object' && raw && 'Value' in raw) {
    return String((raw as { Value?: string }).Value || 'Unknown');
  }
  return String(raw || 'Unknown');
}

function durationHours(begin?: string, end?: string): number | null {
  if (!begin || !end) return null;
  const a = new Date(parseScoutDate(begin) || begin).getTime();
  const b = new Date(parseScoutDate(end) || end).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return Math.round(((b - a) / 3_600_000) * 100) / 100;
}

export async function scoutFetchTrackPeriods(opts: {
  unitId: number;
  fromIso: string;
  toIso: string;
  /** Сколько периодов вернуть в ответе (все считаем) */
  periodsLimit?: number;
}): Promise<ScoutTrackPeriodsStats> {
  return withScoutSession(async (config, sid) => {
    const chunk = await buildAndGetStatistics<TrackChunk>(config, sid, {
      unitId: opts.unitId,
      fromIso: opts.fromIso,
      toIso: opts.toIso,
      servicePath: 'TrackPeriod',
      addMode: 'flat',
    });

    let movementCount = 0;
    let parkingCount = 0;
    let idleCount = 0;
    let breakCount = 0;
    let otherCount = 0;
    const periods: ScoutTrackPeriodRow[] = [];
    const limit = opts.periodsLimit ?? 80;

    for (const p of chunk.Statistics?.Periods ?? []) {
      const type = typeValue(p.Type);
      const t = type.toLowerCase();
      if (t.includes('movement') || t.includes('движ')) movementCount += 1;
      else if (t.includes('idle')) idleCount += 1;
      else if (t.includes('park') || t.includes('стоян')) parkingCount += 1;
      else if (t.includes('break') || t.includes('разрыв')) breakCount += 1;
      else otherCount += 1;

      if (periods.length < limit) {
        const beginIso = p.Period?.Begin ? parseScoutDate(p.Period.Begin) : null;
        const endIso = p.Period?.End ? parseScoutDate(p.Period.End) : null;
        periods.push({
          type,
          beginIso,
          endIso,
          durationHours: durationHours(p.Period?.Begin, p.Period?.End),
        });
      }
    }

    return {
      movementCount,
      parkingCount,
      idleCount,
      breakCount,
      otherCount,
      periods,
      fromIso: opts.fromIso,
      toIso: opts.toIso,
    };
  });
}
