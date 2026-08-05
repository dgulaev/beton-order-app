import { normalizePlate, scoutIsOnline } from '@/lib/fleetLifecycle';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import {
  clearScoutSessionCache,
  getMissingScoutEnvKeys,
  getScoutConfigFromEnv,
  scoutGetAllUnits,
  scoutGetOnlineData,
  scoutGetSession,
  scoutLogin,
  parseScoutDate,
} from './client';
import type { ScoutOnlinePoint, ScoutUnit } from './types';

export type ScoutSyncResult = {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  unitsInScout?: number;
  mapped?: number;
  snapshotsUpdated?: number;
  trailPointsInserted?: number;
  errors?: string[];
};

const TRAIL_RETENTION_DAYS = 90;
/** Не писать точку, если сдвинулась меньше ~15 м и скорость ≈0 (стоянка). */
const TRAIL_MIN_MOVE_DEG = 0.00015;

type MixerRow = {
  id: number;
  number: string;
  scout_unit_id: number | null;
};

type MatchResult = {
  unitToMixer: Map<number, number>;
  collisions: string[];
};

function matchUnitToMixer(units: ScoutUnit[], mixers: MixerRow[]): MatchResult {
  const byScoutId = new Map<number, number>();
  const collisions: string[] = [];
  const unmappedMixers = [...mixers];

  for (const m of mixers) {
    if (m.scout_unit_id == null) continue;
    const prev = byScoutId.get(m.scout_unit_id);
    if (prev != null && prev !== m.id) {
      collisions.push(
        `scout_unit_id=${m.scout_unit_id} привязан к миксерам #${prev} и #${m.id} — обновляется только #${prev}`,
      );
      const idx = unmappedMixers.findIndex((x) => x.id === m.id);
      if (idx >= 0) unmappedMixers.splice(idx, 1);
      continue;
    }
    byScoutId.set(m.scout_unit_id, m.id);
    const idx = unmappedMixers.findIndex((x) => x.id === m.id);
    if (idx >= 0) unmappedMixers.splice(idx, 1);
  }

  for (const unit of units) {
    if (byScoutId.has(unit.UnitId)) continue;
    const unitKey = normalizePlate(unit.Name || unit.StateNumber || '');
    if (!unitKey) continue;
    const idx = unmappedMixers.findIndex((m) => normalizePlate(m.number) === unitKey);
    if (idx >= 0) {
      byScoutId.set(unit.UnitId, unmappedMixers[idx]!.id);
      unmappedMixers.splice(idx, 1);
    }
  }

  return { unitToMixer: byScoutId, collisions };
}

let syncInFlight: Promise<ScoutSyncResult> | null = null;

async function syncScoutTelemetryOnce(): Promise<ScoutSyncResult> {
  const config = getScoutConfigFromEnv();
  if (!config) {
    const missing = getMissingScoutEnvKeys();
    return {
      ok: true,
      skipped: true,
      reason: `SCOUT_* env not configured (нет: ${missing.join(', ') || 'все'}). Проверь Environment = Production на Vercel и Redeploy.`,
    };
  }

  const errors: string[] = [];
  let sessionId: string;
  try {
    sessionId = await scoutGetSession(config);
  } catch (e) {
    clearScoutSessionCache();
    throw e;
  }

  let unitsResp;
  try {
    unitsResp = await scoutGetAllUnits(config, sessionId);
  } catch (e) {
    // Session мог протухнуть раньше ExpireDate — один retry с новым Login
    clearScoutSessionCache();
    sessionId = await scoutLogin(config);
    unitsResp = await scoutGetAllUnits(config, sessionId);
  }

  const units = unitsResp.Units ?? [];
  if (!units.length) {
    return { ok: true, unitsInScout: 0, mapped: 0, snapshotsUpdated: 0 };
  }

  const { data: mixers, error: mixErr } = await supabaseAdmin
    .from('mixers')
    .select('id, number, scout_unit_id');

  if (mixErr) {
    if (/scout_unit_id|fleet_telemetry/i.test(mixErr.message)) {
      return {
        ok: false,
        reason: 'Выполните scripts/fleet-lifecycle.sql',
        errors: [mixErr.message],
      };
    }
    throw mixErr;
  }

  const mixerRows = (mixers ?? []) as MixerRow[];
  const { unitToMixer, collisions } = matchUnitToMixer(units, mixerRows);
  errors.push(...collisions);

  for (const [unitId, mixerId] of unitToMixer) {
    const m = mixerRows.find((r) => r.id === mixerId);
    if (m && m.scout_unit_id !== unitId) {
      const { error } = await supabaseAdmin
        .from('mixers')
        .update({ scout_unit_id: unitId })
        .eq('id', mixerId);
      if (error) errors.push(`scout_unit_id ${mixerId}: ${error.message}`);
      else m.scout_unit_id = unitId;
    }
  }

  const unitIds = units.map((u) => u.UnitId);
  const onlineResp = await scoutGetOnlineData(config, sessionId, unitIds);
  const collection = onlineResp.OnlineDataCollection;
  const targets = collection?.Targets ?? [];
  const points = collection?.DataCollection ?? [];

  // Последние известные координаты — не затираем null'ами, когда ТС offline
  const mappedMixerIds = [...new Set(unitToMixer.values())];
  const prevByMixer = new Map<number, { lat: number | null; lon: number | null; address: string | null }>();
  if (mappedMixerIds.length) {
    const { data: prevRows } = await supabaseAdmin
      .from('fleet_telemetry_snapshots')
      .select('mixer_id, lat, lon, address')
      .in('mixer_id', mappedMixerIds);
    for (const row of prevRows ?? []) {
      prevByMixer.set(row.mixer_id as number, {
        lat: row.lat != null ? Number(row.lat) : null,
        lon: row.lon != null ? Number(row.lon) : null,
        address: row.address != null ? String(row.address) : null,
      });
    }
  }

  const isValidCoord = (lat: number | null, lon: number | null) =>
    lat != null &&
    lon != null &&
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    !(lat === 0 && lon === 0);

  let snapshotsUpdated = 0;
  const trailRows: Array<{
    mixer_id: number;
    scout_unit_id: number;
    lat: number;
    lon: number;
    speed_kmh: number | null;
    recorded_at: string;
    source: string;
  }> = [];

  for (let i = 0; i < targets.length; i++) {
    const unitId = targets[i]!;
    const point: ScoutOnlinePoint | undefined = points[i];
    const mixerId = unitToMixer.get(unitId);
    if (!mixerId || !point) continue;

    const lastAt = parseScoutDate(point.LastMessageTime || point.NavigationTime);
    let lat = point.Navigation?.Location?.Latitude ?? null;
    let lon = point.Navigation?.Location?.Longitude ?? null;
    const speed = point.Navigation?.Speed ?? null;
    let address = point.Address ?? null;
    const isOnline = scoutIsOnline(lastAt);
    const freshLat = lat;
    const freshLon = lon;
    const freshCoordsValid =
      point.IsNavigationValid !== false && isValidCoord(freshLat, freshLon);
    const prevSnap = prevByMixer.get(mixerId);

    // Битая навигация: координаты есть, но СКАУТ помечает их невалидными
    if (point.IsNavigationValid === false) {
      lat = null;
      lon = null;
    }

    // Offline / битая навигация: оставляем последнюю точку на карте
    if (!isValidCoord(lat, lon)) {
      if (prevSnap && isValidCoord(prevSnap.lat, prevSnap.lon)) {
        lat = prevSnap.lat;
        lon = prevSnap.lon;
        if (!address) address = prevSnap.address;
      }
    }

    const { error } = await supabaseAdmin.from('fleet_telemetry_snapshots').upsert(
      {
        mixer_id: mixerId,
        scout_unit_id: unitId,
        lat,
        lon,
        speed_kmh: speed,
        address,
        last_message_at: lastAt,
        is_online: isOnline,
        raw: point as unknown as Record<string, unknown>,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'mixer_id' },
    );

    if (error) {
      errors.push(`snapshot ${mixerId}: ${error.message}`);
    } else {
      snapshotsUpdated += 1;
      prevByMixer.set(mixerId, { lat, lon, address });
    }

    // Trail: только свежие валидные координаты (не last-known offline)
    if (
      freshCoordsValid &&
      isOnline &&
      freshLat != null &&
      freshLon != null &&
      lastAt
    ) {
      const moved =
        !prevSnap ||
        !isValidCoord(prevSnap.lat, prevSnap.lon) ||
        Math.abs((prevSnap.lat as number) - freshLat) > TRAIL_MIN_MOVE_DEG ||
        Math.abs((prevSnap.lon as number) - freshLon) > TRAIL_MIN_MOVE_DEG ||
        (speed != null && Number(speed) >= 3);
      if (moved) {
        trailRows.push({
          mixer_id: mixerId,
          scout_unit_id: unitId,
          lat: freshLat,
          lon: freshLon,
          speed_kmh: speed,
          recorded_at: lastAt,
          source: 'scout_sync',
        });
      }
    }
  }

  let trailPointsInserted = 0;
  if (trailRows.length) {
    const { error: trailErr, count } = await supabaseAdmin
      .from('fleet_telemetry_points')
      .insert(trailRows, { count: 'exact' });
    if (trailErr) {
      if (/fleet_telemetry_points/i.test(trailErr.message)) {
        errors.push('Выполните scripts/fleet-telemetry-points.sql');
      } else {
        errors.push(`trail: ${trailErr.message}`);
      }
    } else {
      trailPointsInserted = count ?? trailRows.length;
    }
  }

  // Retention: подчистка старых точек (лёгкий delete, парк маленький)
  if (trailPointsInserted > 0 || trailRows.length === 0) {
    const cutoff = new Date(
      Date.now() - TRAIL_RETENTION_DAYS * 24 * 60 * 60_000,
    ).toISOString();
    const { error: pruneErr } = await supabaseAdmin
      .from('fleet_telemetry_points')
      .delete()
      .lt('recorded_at', cutoff);
    // Таблица ещё не создана — не шумим, если insert уже сообщил про sql
    if (pruneErr && !/fleet_telemetry_points|does not exist|schema cache/i.test(pruneErr.message)) {
      errors.push(`trail prune: ${pruneErr.message}`);
    }
  }

  return {
    ok: errors.length === 0,
    unitsInScout: units.length,
    mapped: unitToMixer.size,
    snapshotsUpdated,
    trailPointsInserted,
    errors: errors.length ? errors : undefined,
  };
}

/** Sync с mutex — параллельные cron/кнопки не делают двойной Login/upsert. */
export async function syncScoutTelemetry(): Promise<ScoutSyncResult> {
  if (syncInFlight) return syncInFlight;
  syncInFlight = syncScoutTelemetryOnce().finally(() => {
    syncInFlight = null;
  });
  return syncInFlight;
}
