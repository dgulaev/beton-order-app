/**
 * Суточный опрос датчиков СКАУТ → fleet_scout_daily_readings.
 * В паспорт из daily пишем только абсолютный одометр (не моточасы бочки —
 * они за календарный день и ломают ТО / ручной sync).
 */

import { resolveDrumDriveType } from '@/lib/fleetDrumDrive';
import { todayMoscowYmd } from '@/lib/fleetService';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { scoutFetchAnalogSensors } from './analogSensors';
import {
  guessMixerDrumHours,
  scoutFetchDiscreteSensors,
} from './discreteSensors';
import { scoutFetchLatestOdometerKmWithFallback, scoutFetchPeriodMileageKm } from './odometer';
import { scoutFetchMotorModes } from './motorModes';

export type ScoutDailySyncResult = {
  ok: boolean;
  readingDate: string;
  processed: number;
  written: number;
  skipped: number;
  failed: number;
  errors: string[];
};

type MixerRow = {
  id: number;
  number: string;
  vehicle_kind: string | null;
  scout_unit_id: number | null;
  specs: Record<string, unknown> | null;
};

type ExistingReading = {
  id: number;
  odometer_km: number | null;
  chassis_engine_on_hours: number | null;
  drum_engine_hours: number | null;
  fuel_level_l: number | null;
  period_mileage_km: number | null;
};

function hasUsefulValues(v: {
  odometerKm?: number | null;
  chassisOn?: number | null;
  drumHours?: number | null;
  fuelLevelL?: number | null;
  periodMileageKm?: number | null;
}): boolean {
  return (
    (v.odometerKm != null && v.odometerKm > 0) ||
    v.chassisOn != null ||
    v.drumHours != null ||
    v.fuelLevelL != null ||
    v.periodMileageKm != null
  );
}

function existingIsUseful(row: ExistingReading): boolean {
  return hasUsefulValues({
    odometerKm: row.odometer_km != null ? Number(row.odometer_km) : null,
    chassisOn: row.chassis_engine_on_hours != null ? Number(row.chassis_engine_on_hours) : null,
    drumHours: row.drum_engine_hours != null ? Number(row.drum_engine_hours) : null,
    fuelLevelL: row.fuel_level_l != null ? Number(row.fuel_level_l) : null,
    periodMileageKm: row.period_mileage_km != null ? Number(row.period_mileage_km) : null,
  });
}

async function syncOneMixer(
  mixer: MixerRow,
  readingDate: string,
  force: boolean,
  updatePassport: boolean,
): Promise<'written' | 'skipped'> {
  const unitId = mixer.scout_unit_id != null ? Number(mixer.scout_unit_id) : NaN;
  if (!Number.isFinite(unitId) || unitId <= 0) return 'skipped';

  if (!force) {
    const { data: existing } = await supabaseAdmin
      .from('fleet_scout_daily_readings')
      .select(
        'id, odometer_km, chassis_engine_on_hours, drum_engine_hours, fuel_level_l, period_mileage_km',
      )
      .eq('mixer_id', mixer.id)
      .eq('reading_date', readingDate)
      .maybeSingle();
    // Пустая/нулевая строка (сбой утреннего опроса) не блокирует повтор
    if (existing && existingIsUseful(existing as ExistingReading)) return 'skipped';
  }

  const isMixer = String(mixer.vehicle_kind || 'mixer') === 'mixer';
  const specs =
    mixer.specs && typeof mixer.specs === 'object' && !Array.isArray(mixer.specs)
      ? mixer.specs
      : {};
  const drumIdxRaw = specs.scout_drum_sensor_index;
  const preferredSensorIndex =
    drumIdxRaw != null && drumIdxRaw !== '' && Number.isFinite(Number(drumIdxRaw))
      ? Number(drumIdxRaw)
      : null;
  const driveType = resolveDrumDriveType(String(mixer.number || ''), specs);

  const dayFrom = readingDate;
  const dayTo = readingDate;
  const fromIso = `${dayFrom}T00:00:00+03:00`;
  const toIso = `${dayTo}T23:59:59.999+03:00`;

  let odometerKm: number | null = null;
  let chassisOn: number | null = null;
  let chassisIdle: number | null = null;
  let drumHours: number | null = null;
  let drumSensorIndex: number | null = null;
  let fuelLevelL: number | null = null;
  let periodMileageKm: number | null = null;
  const raw: Record<string, unknown> = {
    window: { from: dayFrom, to: dayTo, days: 1 },
  };

  try {
    const odo = await scoutFetchLatestOdometerKmWithFallback({ unitId });
    odometerKm = odo.mileageKm;
    raw.odometer = odo;
  } catch (e) {
    raw.odometerError = e instanceof Error ? e.message : String(e);
  }

  try {
    const mm = await scoutFetchMotorModes({ unitId, fromIso, toIso });
    chassisOn = mm.engineOnHours;
    chassisIdle = mm.engineIdleHours;
    raw.motorModes = mm;
  } catch (e) {
    raw.motorModesError = e instanceof Error ? e.message : String(e);
  }

  try {
    const pm = await scoutFetchPeriodMileageKm({
      unitId,
      fromYmd: dayFrom,
      toYmd: dayTo,
    });
    periodMileageKm = pm.totalMileageKm;
    raw.periodMileage = pm;
  } catch (e) {
    raw.periodMileageError = e instanceof Error ? e.message : String(e);
  }

  try {
    const analog = await scoutFetchAnalogSensors({ unitId, fromIso, toIso });
    fuelLevelL = analog.fuelLevelL;
    raw.fuelLevelL = fuelLevelL;
  } catch (e) {
    raw.analogError = e instanceof Error ? e.message : String(e);
  }

  if (isMixer) {
    try {
      // Суточный снимок — только календарный день (не 7/30/90: иначе в daily
      // попадают часы за неделю, несопоставимые с chassis_* за день).
      const discrete = await scoutFetchDiscreteSensors({
        unitId,
        fromIso,
        toIso,
      });
      const guess = guessMixerDrumHours({
        sensors: discrete.sensors,
        engineOnHours: chassisOn,
        driveType,
        preferredSensorIndex,
      });
      drumHours = guess.drumOnHours;
      drumSensorIndex = guess.sensorIndex;
      raw.drum = { guess, window: { from: dayFrom, to: dayTo, days: 1 } };
    } catch (e) {
      raw.drumError = e instanceof Error ? e.message : String(e);
    }
  }

  const useful = hasUsefulValues({
    odometerKm,
    chassisOn,
    drumHours,
    fuelLevelL,
    periodMileageKm,
  });
  if (!useful) {
    // Не пишем пустую строку — иначе cron skip'нет машину до завтра
    throw new Error('СКАУТ не вернул полезных показаний');
  }

  const { error: upErr } = await supabaseAdmin.from('fleet_scout_daily_readings').upsert(
    {
      mixer_id: mixer.id,
      reading_date: readingDate,
      scout_unit_id: unitId,
      odometer_km: odometerKm,
      chassis_engine_on_hours: chassisOn,
      chassis_engine_idle_hours: chassisIdle,
      drum_engine_hours: drumHours,
      drum_sensor_index: drumSensorIndex,
      fuel_level_l: fuelLevelL,
      period_mileage_km: periodMileageKm,
      raw,
    },
    { onConflict: 'mixer_id,reading_date' },
  );
  if (upErr) {
    if (/fleet_scout_daily_readings|schema cache|does not exist/i.test(upErr.message)) {
      throw new Error('Выполните scripts/fleet-scout-daily.sql');
    }
    throw new Error(upErr.message);
  }

  if (updatePassport) {
    // Только абсолютный одометр. engine_hours — через passport sync (окно 7/30/90).
    const mixerPatch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (odometerKm != null && odometerKm > 0) mixerPatch.odometer_km = odometerKm;
    if (isMixer && drumSensorIndex != null) {
      mixerPatch.specs = {
        ...specs,
        drum_drive_type: driveType,
        scout_drum_sensor_index: drumSensorIndex,
      };
    }
    if (Object.keys(mixerPatch).length > 1) {
      const { error: mixErr } = await supabaseAdmin
        .from('mixers')
        .update(mixerPatch)
        .eq('id', mixer.id);
      if (mixErr) throw new Error(`паспорт: ${mixErr.message}`);
    }
  }

  return 'written';
}

/** Опрос всех ТС с scout_unit_id за дату (МСК). По умолчанию — сегодня. */
export async function syncScoutDailySensors(opts?: {
  readingDate?: string;
  force?: boolean;
  mixerId?: number;
  /** Писать odometer_km в mixers (по умолчанию true). false — только readings. */
  updatePassport?: boolean;
}): Promise<ScoutDailySyncResult> {
  const readingDate = opts?.readingDate || todayMoscowYmd();
  const force = Boolean(opts?.force);
  const updatePassport = opts?.updatePassport !== false;
  const errors: string[] = [];
  let processed = 0;
  let written = 0;
  let skipped = 0;
  let failed = 0;

  let query = supabaseAdmin
    .from('mixers')
    .select('id, number, vehicle_kind, scout_unit_id, specs')
    .not('scout_unit_id', 'is', null)
    .order('id');
  if (opts?.mixerId != null) query = query.eq('id', opts.mixerId);

  const { data: mixers, error } = await query;
  if (error) throw error;

  for (const m of (mixers ?? []) as MixerRow[]) {
    processed += 1;
    try {
      const r = await syncOneMixer(m, readingDate, force, updatePassport);
      if (r === 'written') written += 1;
      else skipped += 1;
    } catch (e) {
      failed += 1;
      errors.push(`${m.number}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return {
    ok: failed === 0,
    readingDate,
    processed,
    written,
    skipped,
    failed,
    errors,
  };
}
