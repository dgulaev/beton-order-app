/** Общий каркас StatisticsController → Add → StartBuild → GetStatistics. */

import {
  clearScoutSessionCache,
  getScoutConfigFromEnv,
  scoutGetSession,
  scoutLogin,
} from './client';
import {
  SCOUT_UNIT_OBJECT_TYPE_ID,
  type ScoutConfig,
  type ScoutStatisticsSessionResponse,
} from './types';

export function toScoutDate(isoOrMs: string | number): string {
  const ms = typeof isoOrMs === 'number' ? isoOrMs : new Date(isoOrMs).getTime();
  return `/Date(${ms})/`;
}

export async function scoutPostJson<T>(
  config: ScoutConfig,
  path: string,
  body: unknown,
  sessionId: string,
  timeoutMs = 60_000,
): Promise<T> {
  const url = `${config.serverUrl.replace(/\/+$/, '')}${path}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ScoutAuthorization: sessionId,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`СКАУТ ${path}: HTTP ${res.status}${text ? ` — ${text.slice(0, 200)}` : ''}`);
  }
  return res.json() as Promise<T>;
}

export type StatsChunkInfo = {
  ChunkNumber?: number;
  ErrorText?: string | null;
  IsFinalChunk?: boolean;
  Status?: { Value?: string };
};

/** ISO-8601 duration → часы (десятичные). */
export function parseIsoDurationHours(raw: string | null | undefined): number | null {
  if (!raw || typeof raw !== 'string') return null;
  const m = raw.match(
    /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i,
  );
  if (!m) return null;
  const days = Number(m[1] || 0);
  const h = Number(m[2] || 0);
  const min = Number(m[3] || 0);
  const sec = Number(m[4] || 0);
  return Math.round((days * 24 + h + min / 60 + sec / 3600) * 100) / 100;
}

export async function withScoutSession<T>(
  run: (config: ScoutConfig, sid: string) => Promise<T>,
): Promise<T> {
  const config = getScoutConfigFromEnv();
  if (!config) throw new Error('SCOUT_* env not configured');
  let sid: string;
  try {
    sid = await scoutGetSession(config);
  } catch (e) {
    clearScoutSessionCache();
    throw e;
  }
  try {
    return await run(config, sid);
  } catch (e) {
    clearScoutSessionCache();
    const sid2 = await scoutLogin(config);
    return run(config, sid2);
  }
}

export async function startStatsSession(
  config: ScoutConfig,
  sid: string,
  unitId: number,
  fromIso: string,
  toIso: string,
): Promise<string> {
  const started = await scoutPostJson<ScoutStatisticsSessionResponse>(
    config,
    '/spic/StatisticsController/rest/StartStatisticsSession',
    {
      Period: { Begin: toScoutDate(fromIso), End: toScoutDate(toIso) },
      TargetObject: {
        ObjectTypeId: SCOUT_UNIT_OBJECT_TYPE_ID,
        ObjectId: unitId,
      },
    },
    sid,
  );
  const id = started.Session?.StatisticsSessionId;
  if (!id) throw new Error('СКАУТ: не удалось открыть сессию статистик');
  return id;
}

type AddBodyMode = 'flat' | 'session' | 'sessionNullSensors';

export async function buildAndGetStatistics<T extends { ChunkInfo?: StatsChunkInfo }>(
  config: ScoutConfig,
  sid: string,
  opts: {
    unitId: number;
    fromIso: string;
    toIso: string;
    servicePath: string; // e.g. MotorModes
    addMode?: AddBodyMode;
    polls?: number;
    pollDelayMs?: number;
  },
): Promise<T> {
  const statsSessionId = await startStatsSession(
    config,
    sid,
    opts.unitId,
    opts.fromIso,
    opts.toIso,
  );
  const addPath = `/spic/${opts.servicePath}/rest/AddStatisticsRequest`;
  const mode = opts.addMode ?? 'flat';

  const tryAdd = async (body: unknown) =>
    scoutPostJson<{ ErrorText?: string | null; Status?: { Value?: string } }>(
      config,
      addPath,
      body,
      sid,
    );

  if (mode === 'flat') {
    try {
      await tryAdd({ StatisticsSessionId: statsSessionId });
    } catch {
      await tryAdd({
        Session: { StatisticsSessionId: statsSessionId },
        Settings: {},
      });
    }
  } else if (mode === 'sessionNullSensors') {
    await tryAdd({
      Session: { StatisticsSessionId: statsSessionId },
      Settings: { SensorNumbers: null },
    });
  } else {
    await tryAdd({
      Session: { StatisticsSessionId: statsSessionId },
      Settings: {},
    });
  }

  await scoutPostJson(
    config,
    '/spic/StatisticsController/rest/StartBuild',
    { StatisticsSessionId: statsSessionId },
    sid,
  );

  const polls = opts.polls ?? 12;
  const delay = opts.pollDelayMs ?? 800;
  let last: T | null = null;
  for (let attempt = 0; attempt < polls; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, delay));
    const chunk = await scoutPostJson<T>(
      config,
      `/spic/${opts.servicePath}/rest/GetStatistics`,
      { StatisticsSessionId: statsSessionId },
      sid,
    );
    last = chunk;
    if (chunk.ChunkInfo?.ErrorText) {
      throw new Error(`СКАУТ ${opts.servicePath}: ${chunk.ChunkInfo.ErrorText}`);
    }
    const status = chunk.ChunkInfo?.Status?.Value;
    if (chunk.ChunkInfo?.IsFinalChunk || status === 'Ok') break;
  }
  if (!last) throw new Error(`СКАУТ ${opts.servicePath}: пустой ответ`);
  return last;
}
