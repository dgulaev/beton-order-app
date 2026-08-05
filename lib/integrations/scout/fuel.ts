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
  type ScoutFuelingDefuelingResult,
  type ScoutFuelingEvent,
  type ScoutFuelingStats,
  type ScoutStatisticsSessionResponse,
} from './types';

function toScoutDate(isoOrMs: string | number): string {
  const ms = typeof isoOrMs === 'number' ? isoOrMs : new Date(isoOrMs).getTime();
  return `/Date(${ms})/`;
}

async function scoutPostFuel<T>(
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

function eventTypeValue(raw: unknown): ScoutFuelingEvent['eventType'] {
  const v =
    typeof raw === 'object' && raw && 'Value' in raw
      ? String((raw as { Value?: string }).Value || '')
      : String(raw || '');
  if (v === 'Fueling' || v === 'Defueling') return v;
  return 'None';
}

function litersDelta(begin: number | null, end: number | null): number | null {
  if (begin == null || end == null) return null;
  if (!Number.isFinite(begin) || !Number.isFinite(end)) return null;
  return Math.round((end - begin) * 10) / 10;
}

/**
 * Заправки / сливы / расход за период — SpicFuelingDefuelingStatisticsService (fdstat).
 * Нужен настроенный ДУТ в СКАУТ-Студио; без датчика Events будут пустыми.
 */
export async function scoutFetchFuelingStats(opts: {
  unitId: number;
  fromIso: string;
  toIso: string;
}): Promise<ScoutFuelingStats> {
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

  const run = async (sid: string): Promise<ScoutFuelingStats> => {
    const started = await scoutPostFuel<ScoutStatisticsSessionResponse>(
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
      throw new Error('СКАУТ: не удалось открыть сессию статистик (топливо)');
    }

    // fdstat REST ждёт плоский { StatisticsSessionId } (не Session:{...} как у NavigationFiltration).
    await scoutPostFuel(
      config,
      '/spic/fdstat/rest/AddStatisticsRequest',
      { StatisticsSessionId: statsSessionId },
      sid,
    );

    await scoutPostFuel(
      config,
      '/spic/StatisticsController/rest/StartBuild',
      { StatisticsSessionId: statsSessionId },
      sid,
    );

    let last: ScoutFuelingDefuelingResult | null = null;
    const eventsByKey = new Map<string, ScoutFuelingEvent>();
    for (let attempt = 0; attempt < 16; attempt++) {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, 900));
      }
      const chunk = await scoutPostFuel<ScoutFuelingDefuelingResult>(
        config,
        '/spic/fdstat/rest/GetStatistics',
        { StatisticsSessionId: statsSessionId },
        sid,
      );
      last = chunk;
      if (chunk.ChunkInfo?.ErrorText) {
        throw new Error(`СКАУТ fdstat: ${chunk.ChunkInfo.ErrorText}`);
      }

      for (const ev of chunk.Statistics?.Events ?? []) {
        const begin = ev.BeginFuelVolumeL != null ? Number(ev.BeginFuelVolumeL) : null;
        const end = ev.EndFuelVolumeL != null ? Number(ev.EndFuelVolumeL) : null;
        const ts = parseScoutDate(ev.Timestamp) || parseScoutDate(ev.Period?.Begin);
        if (!ts) continue;
        let type = eventTypeValue(ev.EventType);
        const delta = litersDelta(begin, end);
        // Если тип не пришёл — угадываем по знаку дельты уровня бака
        if (type === 'None' && delta != null) {
          if (delta > 0.05) type = 'Fueling';
          else if (delta < -0.05) type = 'Defueling';
        }
        const lat = ev.Location?.Latitude != null ? Number(ev.Location.Latitude) : null;
        const lon = ev.Location?.Longitude != null ? Number(ev.Location.Longitude) : null;
        const parsed: ScoutFuelingEvent = {
          timestamp: ts,
          eventType: type,
          beginLiters: begin != null && Number.isFinite(begin) ? begin : null,
          endLiters: end != null && Number.isFinite(end) ? end : null,
          deltaLiters: delta,
          lat: lat != null && Number.isFinite(lat) ? lat : null,
          lon: lon != null && Number.isFinite(lon) ? lon : null,
        };
        eventsByKey.set(`${ts}|${type}|${begin}|${end}`, parsed);
      }

      const status = chunk.ChunkInfo?.Status?.Value;
      if (chunk.ChunkInfo?.IsFinalChunk || status === 'Ok') break;
    }

    const s = last?.Statistics;
    const events = [...eventsByKey.values()].sort((a, b) =>
      a.timestamp.localeCompare(b.timestamp),
    );

    return {
      beginFuelVolumeL:
        s?.BeginFuelVolumeL != null && Number.isFinite(Number(s.BeginFuelVolumeL))
          ? Number(s.BeginFuelVolumeL)
          : null,
      endFuelVolumeL:
        s?.EndFuelVolumeL != null && Number.isFinite(Number(s.EndFuelVolumeL))
          ? Number(s.EndFuelVolumeL)
          : null,
      fuelingTotalVolumeL:
        s?.FuelingTotalVolumeL != null && Number.isFinite(Number(s.FuelingTotalVolumeL))
          ? Number(s.FuelingTotalVolumeL)
          : null,
      defuelingTotalVolumeL:
        s?.DefuelingTotalVolumeL != null && Number.isFinite(Number(s.DefuelingTotalVolumeL))
          ? Number(s.DefuelingTotalVolumeL)
          : null,
      totalFuelConsumptionL:
        s?.TotalFuelConsumptionL != null && Number.isFinite(Number(s.TotalFuelConsumptionL))
          ? Number(s.TotalFuelConsumptionL)
          : null,
      fuelingCount: Number(s?.FuelingCount) || 0,
      defuelingCount: Number(s?.DefuelingCount) || 0,
      events,
    };
  };

  try {
    return await run(sessionId);
  } catch (e) {
    clearScoutSessionCache();
    const sid2 = await scoutLogin(config);
    return run(sid2);
  }
}

/** Стабильный ключ для идемпотентного импорта в fuel_entries. */
export function scoutFuelEventKey(
  unitId: number,
  ev: Pick<ScoutFuelingEvent, 'timestamp' | 'eventType' | 'beginLiters' | 'endLiters'>,
): string {
  return [
    'scout',
    unitId,
    ev.eventType,
    ev.timestamp,
    ev.beginLiters ?? '',
    ev.endLiters ?? '',
  ].join(':');
}
