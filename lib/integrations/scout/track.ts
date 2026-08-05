import { parseScoutDate } from './parseDate';
import {
  clearScoutSessionCache,
  getScoutConfigFromEnv,
  scoutGetSession,
  scoutLogin,
} from './client';
import {
  SCOUT_UNIT_OBJECT_TYPE_ID,
  type ScoutConfig,
  type ScoutNavigationFiltrationResult,
  type ScoutNavTrackPoint,
  type ScoutStatisticsSessionResponse,
} from './types';

function toScoutDate(isoOrMs: string | number): string {
  const ms = typeof isoOrMs === 'number' ? isoOrMs : new Date(isoOrMs).getTime();
  return `/Date(${ms})/`;
}

async function scoutPostTrack<T>(
  config: ScoutConfig,
  path: string,
  body: unknown,
  sessionId: string,
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
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`СКАУТ ${path}: HTTP ${res.status}${text ? ` — ${text.slice(0, 200)}` : ''}`);
  }
  return res.json() as Promise<T>;
}

/**
 * История точек навигации за период через СПИК NavigationFiltration
 * (сырые lat/lon для polyline).
 */
export async function scoutFetchNavigationTrack(opts: {
  unitId: number;
  fromIso: string;
  toIso: string;
}): Promise<ScoutNavTrackPoint[]> {
  const config = getScoutConfigFromEnv();
  if (!config) {
    throw new Error('SCOUT_* env not configured');
  }

  let sessionId: string;
  try {
    sessionId = await scoutGetSession(config);
  } catch (e) {
    clearScoutSessionCache();
    throw e;
  }

  const run = async (sid: string) => {
    const started = await scoutPostTrack<ScoutStatisticsSessionResponse>(
      config,
      '/spic/StatisticsController/rest/StartStatisticsSession',
      {
        Period: {
          Begin: toScoutDate(opts.fromIso),
          End: toScoutDate(opts.toIso),
        },
        TargetObject: {
          ObjectTypeId: SCOUT_UNIT_OBJECT_TYPE_ID,
          ObjectId: opts.unitId,
        },
      },
      sid,
    );

    const statsSessionId = started.Session?.StatisticsSessionId;
    if (!statsSessionId) {
      throw new Error('СКАУТ: не удалось открыть сессию статистик');
    }

    await scoutPostTrack(
      config,
      '/spic/NavigationFiltration/rest/AddStatisticsRequest',
      {
        Session: { StatisticsSessionId: statsSessionId },
        Settings: {
          NavigationValidationFilter: {
            ExcludeValidPoints: false,
            ExcludeInvalidPoints: true,
            ExcludeNotValidatedPoints: true,
          },
          TrackPeriodsFilter: {
            ExcludeRecoilPoints: true,
            ExcludeNotMovePoints: false,
            IncludeParkingPoints: true,
          },
        },
      },
      sid,
    );

    await scoutPostTrack(
      config,
      '/spic/StatisticsController/rest/StartBuild',
      { StatisticsSessionId: statsSessionId },
      sid,
    );

    const points: ScoutNavTrackPoint[] = [];
    for (let attempt = 0; attempt < 12; attempt++) {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, 800));
      }
      const chunk = await scoutPostTrack<ScoutNavigationFiltrationResult>(
        config,
        '/spic/NavigationFiltration/rest/GetStatistics',
        { StatisticsSessionId: statsSessionId },
        sid,
      );

      const status = chunk.ChunkInfo?.Status?.Value;
      if (chunk.ChunkInfo?.ErrorText) {
        throw new Error(`СКАУТ NavigationFiltration: ${chunk.ChunkInfo.ErrorText}`);
      }

      for (const p of chunk.Statistics?.Points ?? []) {
        if (p.IsNavigationValid === false) continue;
        const lat = p.Navigation?.Location?.Latitude;
        const lon = p.Navigation?.Location?.Longitude;
        if (lat == null || lon == null) continue;
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        if (lat === 0 && lon === 0) continue;
        const recordedAt = parseScoutDate(p.Timestamp);
        if (!recordedAt) continue;
        points.push({
          lat,
          lon,
          speedKmh: p.Navigation?.Speed != null ? Number(p.Navigation.Speed) : null,
          recordedAt,
        });
      }

      if (chunk.ChunkInfo?.IsFinalChunk || status === 'Ok') break;
    }

    points.sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
    return points;
  };

  try {
    return await run(sessionId);
  } catch (e) {
    clearScoutSessionCache();
    const sid2 = await scoutLogin(config);
    return run(sid2);
  }
}
