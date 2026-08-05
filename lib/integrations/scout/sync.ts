import { normalizePlate, scoutIsOnline } from '@/lib/fleetLifecycle';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import {
  clearScoutSessionCache,
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
  errors?: string[];
};

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
    return { ok: true, skipped: true, reason: 'SCOUT_* env not configured' };
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

    // Битая навигация: координаты есть, но СКАУТ помечает их невалидными
    if (point.IsNavigationValid === false) {
      lat = null;
      lon = null;
    }

    // Offline / битая навигация: оставляем последнюю точку на карте
    if (!isValidCoord(lat, lon)) {
      const prev = prevByMixer.get(mixerId);
      if (prev && isValidCoord(prev.lat, prev.lon)) {
        lat = prev.lat;
        lon = prev.lon;
        if (!address) address = prev.address;
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
  }

  return {
    ok: errors.length === 0,
    unitsInScout: units.length,
    mapped: unitToMixer.size,
    snapshotsUpdated,
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
