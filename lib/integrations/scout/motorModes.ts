import {
  buildAndGetStatistics,
  parseIsoDurationHours,
  withScoutSession,
} from './statsCommon';

export type ScoutMotorModesStats = {
  engineOnHours: number | null;
  engineOffHours: number | null;
  engineActiveWorkHours: number | null;
  engineIdleHours: number | null;
  periodsCount: number;
  fromIso: string;
  toIso: string;
};

type MotorChunk = {
  ChunkInfo?: { ErrorText?: string | null; IsFinalChunk?: boolean; Status?: { Value?: string } };
  Statistics?: {
    EngineOnHours?: string;
    EngineOffHours?: string;
    EngineActiveWorkHours?: string;
    EngineIdleHours?: string;
    Periods?: unknown[];
  } | null;
};

export async function scoutFetchMotorModes(opts: {
  unitId: number;
  fromIso: string;
  toIso: string;
}): Promise<ScoutMotorModesStats> {
  return withScoutSession(async (config, sid) => {
    const chunk = await buildAndGetStatistics<MotorChunk>(config, sid, {
      unitId: opts.unitId,
      fromIso: opts.fromIso,
      toIso: opts.toIso,
      servicePath: 'MotorModes',
      addMode: 'flat',
    });
    const s = chunk.Statistics;
    return {
      engineOnHours: parseIsoDurationHours(s?.EngineOnHours),
      engineOffHours: parseIsoDurationHours(s?.EngineOffHours),
      engineActiveWorkHours: parseIsoDurationHours(s?.EngineActiveWorkHours),
      engineIdleHours: parseIsoDurationHours(s?.EngineIdleHours),
      periodsCount: s?.Periods?.length ?? 0,
      fromIso: opts.fromIso,
      toIso: opts.toIso,
    };
  });
}
