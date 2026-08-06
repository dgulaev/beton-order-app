/**
 * Одометр / пробег из СКАУТ:
 * - `/spic/Odometer` — абсолютные показания (CAN / виртуальный одометр)
 * - `/spic/trackPeriodsMileage` — пробег за период по GPS (fallback-справка)
 */

import { todayMoscowYmd } from '@/lib/fleetService';
import {
  clearScoutSessionCache,
  getScoutConfigFromEnv,
  scoutGetSession,
  scoutLogin,
} from './client';
import { parseScoutDate } from './parseDate';
import {
  SCOUT_UNIT_OBJECT_TYPE_ID,
  type ScoutConfig,
  type ScoutStatisticsSessionResponse,
} from './types';

function toScoutDate(isoOrMs: string | number): string {
  const ms = typeof isoOrMs === 'number' ? isoOrMs : new Date(isoOrMs).getTime();
  return `/Date(${ms})/`;
}

async function scoutPostOdo<T>(
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

type OdoChunk = {
  ChunkInfo?: {
    ChunkNumber?: number;
    ErrorText?: string | null;
    IsFinalChunk?: boolean;
    Status?: { Value?: string };
  };
  Statistics?: {
    MileageKm?: number | null;
    Error?: string | null;
    Timestamp?: string | null;
  } | null;
};

type MileageChunk = {
  ChunkInfo?: {
    ErrorText?: string | null;
    IsFinalChunk?: boolean;
    Status?: { Value?: string };
  };
  Statistics?: {
    TotalMileageKm?: number | null;
    MovementMileageKm?: number | null;
  } | null;
};

export type ScoutOdometerReading = {
  /** Абсолютный одометр, км (если датчик в СКАУТ есть) */
  mileageKm: number | null;
  error: string | null;
  dayYmd: string;
  atIso: string | null;
  source: 'odometer' | 'analog_nav';
  /** Имя аналогового датчика, если source=analog_nav */
  sensorName?: string | null;
};

export type ScoutPeriodMileage = {
  totalMileageKm: number | null;
  movementMileageKm: number | null;
  fromYmd: string;
  toYmd: string;
  source: 'trackPeriodsMileage';
};

function ymdMoscowFromMs(ms: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ms));
}

function shiftMoscowYmd(ymd: string, days: number): string {
  const base = new Date(`${ymd}T12:00:00+03:00`).getTime();
  return ymdMoscowFromMs(base + days * 86_400_000);
}

/** Один календарный день МСК: [day 00:00, next 00:00) — как рекомендует дока СПИК. */
async function fetchOdometerForDay(
  config: ScoutConfig,
  sid: string,
  unitId: number,
  dayYmd: string,
): Promise<ScoutOdometerReading> {
  const next = shiftMoscowYmd(dayYmd, 1);
  const fromIso = `${dayYmd}T00:00:00+03:00`;
  const toIso = `${next}T00:00:00+03:00`;

  const started = await scoutPostOdo<ScoutStatisticsSessionResponse>(
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

  const statsSessionId = started.Session?.StatisticsSessionId;
  if (!statsSessionId) {
    throw new Error('СКАУТ: не удалось открыть сессию статистик (одометр)');
  }

  await scoutPostOdo(
    config,
    '/spic/Odometer/rest/AddStatisticsRequest',
    { StatisticsSessionId: statsSessionId },
    sid,
  );

  await scoutPostOdo(
    config,
    '/spic/StatisticsController/rest/StartBuild',
    { StatisticsSessionId: statsSessionId },
    sid,
  );

  let last: OdoChunk | null = null;
  for (let attempt = 0; attempt < 10; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 700));
    const chunk = await scoutPostOdo<OdoChunk>(
      config,
      '/spic/Odometer/rest/GetStatistics',
      { StatisticsSessionId: statsSessionId },
      sid,
    );
    last = chunk;
    if (chunk.ChunkInfo?.ErrorText) {
      throw new Error(`СКАУТ Odometer: ${chunk.ChunkInfo.ErrorText}`);
    }
    const status = chunk.ChunkInfo?.Status?.Value;
    if (chunk.ChunkInfo?.IsFinalChunk || status === 'Ok') break;
  }

  const st = last?.Statistics;
  const km =
    st?.MileageKm != null && Number.isFinite(Number(st.MileageKm))
      ? Math.round(Number(st.MileageKm) * 10) / 10
      : null;
  const err = st?.Error ? String(st.Error) : km == null ? 'NoData' : null;

  return {
    mileageKm: km,
    error: err,
    dayYmd,
    atIso: st?.Timestamp ? parseScoutDate(st.Timestamp) : null,
    source: 'odometer',
  };
}

/**
 * Последние показания одометра: вчера → позавчера → … → сегодня (дока: сутки целиком).
 */
export async function scoutFetchLatestOdometerKm(opts: {
  unitId: number;
  /** Сколько суток назад перебирать (включая сегодня) */
  lookbackDays?: number;
}): Promise<ScoutOdometerReading> {
  const config = getScoutConfigFromEnv();
  if (!config) throw new Error('SCOUT_* env not configured');

  let sessionId: string;
  try {
    sessionId = await scoutGetSession(config);
  } catch (e) {
    clearScoutSessionCache();
    throw e;
  }

  const lookback = Math.min(14, Math.max(1, opts.lookbackDays ?? 5));
  const today = todayMoscowYmd();

  const run = async (sid: string): Promise<ScoutOdometerReading> => {
    let lastNoData: ScoutOdometerReading | null = null;
    // Сначала вчера (данные обычно уже выгружены), потом глубже, сегодня — в конце
    const days: string[] = [];
    for (let i = 1; i < lookback; i++) days.push(shiftMoscowYmd(today, -i));
    days.push(today);

    for (const day of days) {
      const reading = await fetchOdometerForDay(config, sid, opts.unitId, day);
      if (reading.mileageKm != null && reading.mileageKm > 0) {
        return reading;
      }
      if (reading.error === 'NoSensor') {
        return reading;
      }
      lastNoData = reading;
    }
    return (
      lastNoData ?? {
        mileageKm: null,
        error: 'NoData',
        dayYmd: today,
        atIso: null,
        source: 'odometer',
      }
    );
  };

  try {
    return await run(sessionId);
  } catch (e) {
    clearScoutSessionCache();
    const sid2 = await scoutLogin(config);
    return run(sid2);
  }
}

/**
 * Одометр SPIK, при NoSensor/NoData — fallback на аналог «Пробег по навигации».
 * На многих миксерах /spic/Odometer пустой, а аналог отдаёт абсолютные км.
 */
export async function scoutFetchLatestOdometerKmWithFallback(opts: {
  unitId: number;
  lookbackDays?: number;
}): Promise<ScoutOdometerReading> {
  const primary = await scoutFetchLatestOdometerKm(opts);
  if (primary.mileageKm != null && primary.mileageKm > 0) return primary;

  try {
    const { scoutFetchAnalogSensors } = await import('./analogSensors');
    const today = todayMoscowYmd();
    const fromIso = `${shiftMoscowYmd(today, -2)}T00:00:00+03:00`;
    const toIso = `${today}T23:59:59.999+03:00`;
    const analog = await scoutFetchAnalogSensors({
      unitId: opts.unitId,
      fromIso,
      toIso,
    });
    const candidates = analog.sensors.filter((s) => {
      if (s.lastValue == null || !Number.isFinite(s.lastValue) || s.lastValue < 1000) return false;
      // только явный пробег/одометр в имени (не «№14» с мВ питания)
      return (
        s.kind === 'odometer_like' ||
        /пробег|одометр|навигац|mileage|odometer/i.test(s.name || '')
      );
    });
    candidates.sort((a, b) => (b.lastValue ?? 0) - (a.lastValue ?? 0));
    const best = candidates[0];
    if (best?.lastValue != null) {
      return {
        mileageKm: Math.round(best.lastValue * 10) / 10,
        error: null,
        dayYmd: today,
        atIso: best.lastAtIso,
        source: 'analog_nav',
        sensorName: best.name,
      };
    }
  } catch {
    /* оставляем primary */
  }

  return primary;
}

/** Пробег за период по GPS (не абсолютный одометр). */
export async function scoutFetchPeriodMileageKm(opts: {
  unitId: number;
  fromYmd: string;
  toYmd: string;
}): Promise<ScoutPeriodMileage> {
  const config = getScoutConfigFromEnv();
  if (!config) throw new Error('SCOUT_* env not configured');

  let sessionId: string;
  try {
    sessionId = await scoutGetSession(config);
  } catch (e) {
    clearScoutSessionCache();
    throw e;
  }

  const fromIso = `${opts.fromYmd}T00:00:00+03:00`;
  const toIso = `${opts.toYmd}T23:59:59.999+03:00`;

  const run = async (sid: string): Promise<ScoutPeriodMileage> => {
    const started = await scoutPostOdo<ScoutStatisticsSessionResponse>(
      config,
      '/spic/StatisticsController/rest/StartStatisticsSession',
      {
        Period: { Begin: toScoutDate(fromIso), End: toScoutDate(toIso) },
        TargetObject: {
          ObjectTypeId: SCOUT_UNIT_OBJECT_TYPE_ID,
          ObjectId: opts.unitId,
        },
      },
      sid,
    );
    const statsSessionId = started.Session?.StatisticsSessionId;
    if (!statsSessionId) {
      throw new Error('СКАУТ: не удалось открыть сессию статистик (пробег)');
    }

    await scoutPostOdo(
      config,
      '/spic/trackPeriodsMileage/rest/AddStatisticsRequest',
      { StatisticsSessionId: statsSessionId },
      sid,
    );
    await scoutPostOdo(
      config,
      '/spic/StatisticsController/rest/StartBuild',
      { StatisticsSessionId: statsSessionId },
      sid,
    );

    let last: MileageChunk | null = null;
    for (let attempt = 0; attempt < 12; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 800));
      const chunk = await scoutPostOdo<MileageChunk>(
        config,
        '/spic/trackPeriodsMileage/rest/GetStatistics',
        { StatisticsSessionId: statsSessionId },
        sid,
      );
      last = chunk;
      if (chunk.ChunkInfo?.ErrorText) {
        throw new Error(`СКАУТ trackPeriodsMileage: ${chunk.ChunkInfo.ErrorText}`);
      }
      const status = chunk.ChunkInfo?.Status?.Value;
      if (chunk.ChunkInfo?.IsFinalChunk || status === 'Ok') break;
    }

    const s = last?.Statistics;
    const total =
      s?.TotalMileageKm != null && Number.isFinite(Number(s.TotalMileageKm))
        ? Math.round(Number(s.TotalMileageKm) * 10) / 10
        : null;
    const move =
      s?.MovementMileageKm != null && Number.isFinite(Number(s.MovementMileageKm))
        ? Math.round(Number(s.MovementMileageKm) * 10) / 10
        : null;

    return {
      totalMileageKm: total,
      movementMileageKm: move,
      fromYmd: opts.fromYmd,
      toYmd: opts.toYmd,
      source: 'trackPeriodsMileage',
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
