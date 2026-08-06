import { NextRequest, NextResponse } from 'next/server';
import { FLEET_MUTATION_ROLES, requireAdminCifraStaff } from '@/lib/adminCifraAuth';
import { resolveDrumDriveType } from '@/lib/fleetDrumDrive';
import { defaultFuelHistoryPeriod } from '@/lib/fleetCosts';
import {
  getMissingScoutEnvKeys,
  guessMixerDrumHours,
  isScoutConfigured,
  scoutFetchDiscreteSensorsWithFallback,
  scoutFetchLatestOdometerKmWithFallback,
  scoutFetchMotorModes,
  scoutFetchPeriodMileageKm,
  syncScoutDailySensors,
} from '@/lib/integrations/scout';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

/**
 * POST { mixer_id, sensor_index? }
 * Одна точка: одометр (+fallback аналог) + моточасы бочки (миксеры) → поля паспорта.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request, FLEET_MUTATION_ROLES);
  if (auth.error) return auth.error;

  if (!isScoutConfigured()) {
    return NextResponse.json(
      {
        success: false,
        error: `СКАУТ не настроен (нет ${getMissingScoutEnvKeys().join(', ') || 'SCOUT_*'})`,
      },
      { status: 503 },
    );
  }

  try {
    const body = await request.json().catch(() => ({}));
    const mixerId = Number(body.mixer_id);
    if (!Number.isFinite(mixerId) || mixerId <= 0) {
      return NextResponse.json({ success: false, error: 'mixer_id обязателен' }, { status: 400 });
    }

    const { data: mixer, error: mixerErr } = await supabaseAdmin
      .from('mixers')
      .select('id, number, vehicle_kind, odometer_km, engine_hours, scout_unit_id, specs')
      .eq('id', mixerId)
      .maybeSingle();

    if (mixerErr || !mixer) {
      return NextResponse.json({ success: false, error: 'ТС не найдено' }, { status: 404 });
    }

    const unitId = mixer.scout_unit_id != null ? Number(mixer.scout_unit_id) : NaN;
    if (!Number.isFinite(unitId) || unitId <= 0) {
      return NextResponse.json(
        {
          success: false,
          error: `У «${mixer.number}» нет привязки СКАУТ (scout_unit_id). Укажи UnitId в паспорте и сохрани.`,
        },
        { status: 400 },
      );
    }

    const vehicleKind = String(mixer.vehicle_kind || 'mixer');
    const isMixer = vehicleKind === 'mixer';
    const specs =
      mixer.specs && typeof mixer.specs === 'object' && !Array.isArray(mixer.specs)
        ? (mixer.specs as Record<string, unknown>)
        : {};
    const drumIdxRaw = body.sensor_index ?? specs.scout_drum_sensor_index;
    const preferredSensorIndex =
      drumIdxRaw != null && drumIdxRaw !== '' && Number.isFinite(Number(drumIdxRaw))
        ? Number(drumIdxRaw)
        : null;
    const driveType = resolveDrumDriveType(String(mixer.number || ''), specs);
    const period = defaultFuelHistoryPeriod();

    const messages: string[] = [];
    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    let nextSpecs: Record<string, unknown> | null = null;

    // --- Одометр ---
    let odometerKm: number | null =
      mixer.odometer_km != null ? Number(mixer.odometer_km) : null;
    let odometerApplied = false;
    let odometerSource: string | null = null;
    try {
      const reading = await scoutFetchLatestOdometerKmWithFallback({ unitId });
      if (reading.mileageKm != null && reading.mileageKm > 0) {
        patch.odometer_km = reading.mileageKm;
        odometerKm = reading.mileageKm;
        odometerApplied = true;
        odometerSource = reading.source;
        messages.push(
          `Одометр: ${reading.mileageKm} км` +
            (reading.source === 'analog_nav'
              ? ` (аналог${reading.sensorName ? `: ${reading.sensorName}` : ''})`
              : ` (${reading.dayYmd})`),
        );
      } else {
        messages.push(
          `Одометр: в СКАУТ нет датчика` +
            (reading.error ? ` (${reading.error})` : '') +
            ' — для этой машины одометр в паспорт из СКАУТ не подтянуть',
        );
        try {
          const pm = await scoutFetchPeriodMileageKm({
            unitId,
            fromYmd: period.from,
            toYmd: period.to,
          });
          if (pm.totalMileageKm != null) {
            messages.push(
              `пробег GPS с ${pm.fromYmd}: ${pm.totalMileageKm} км (в одометр не пишем — это не абсолют)`,
            );
          }
        } catch {
          /* ignore */
        }
      }
    } catch (e) {
      messages.push(
        `Одометр: ошибка — ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    // --- Моточасы бочки (только миксеры) ---
    let engineHours: number | null =
      mixer.engine_hours != null ? Number(mixer.engine_hours) : null;
    let drumApplied = false;
    let drumSensorIndex: number | null = preferredSensorIndex;

    if (isMixer) {
      try {
        // YTD у DiscreteSensor на сервере часто без Points — берём 7→30→90 суток
        const discrete = await scoutFetchDiscreteSensorsWithFallback({ unitId });
        const motorModes = await scoutFetchMotorModes({
          unitId,
          fromIso: discrete.fromIso,
          toIso: discrete.toIso,
        }).catch(() => null);
        const guess = guessMixerDrumHours({
          sensors: discrete.sensors,
          engineOnHours: motorModes?.engineOnHours ?? null,
          driveType,
          preferredSensorIndex,
        });
        if (guess.drumOnHours != null) {
          const hours = Math.round(guess.drumOnHours * 100) / 100;
          patch.engine_hours = hours;
          engineHours = hours;
          drumApplied = true;
          drumSensorIndex = guess.sensorIndex;
          nextSpecs = {
            ...specs,
            drum_drive_type: driveType,
            ...(guess.sensorIndex != null
              ? { scout_drum_sensor_index: guess.sensorIndex }
              : {}),
            scout_drum_hours_from: discrete.fromYmd,
            scout_drum_hours_to: discrete.toYmd,
          };
          messages.push(
            `Моточасы бочки: ${hours} ч за ${discrete.fromYmd} — ${discrete.toYmd}`,
          );
        } else {
          messages.push(
            `Моточасы бочки: не удалось определить канал за последние 7–90 суток`,
          );
        }
      } catch (e) {
        messages.push(
          `Моточасы бочки: ошибка — ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    if (nextSpecs) patch.specs = nextSpecs;

    const wroteSomething = odometerApplied || drumApplied;
    if (wroteSomething) {
      const { error: upErr } = await supabaseAdmin
        .from('mixers')
        .update(patch)
        .eq('id', mixerId);
      if (upErr) throw new Error(upErr.message);
    }

    // Суточный снимок в БД без повторной записи паспорта (иначе daily
    // затрёт engine_hours часами за 1 день поверх окна 7/30/90).
    let daily: { written: number; error?: string } | null = null;
    try {
      const dailyResult = await syncScoutDailySensors({
        mixerId,
        force: true,
        updatePassport: false,
      });
      daily = { written: dailyResult.written };
      if (dailyResult.errors.length) {
        daily.error = dailyResult.errors[0];
        messages.push(`Суточный снимок: ${dailyResult.errors[0]}`);
      } else if (dailyResult.written > 0) {
        messages.push('Суточный снимок записан в БД');
      }
    } catch (e) {
      daily = { written: 0, error: e instanceof Error ? e.message : String(e) };
      messages.push(`Суточный снимок: ${daily.error}`);
    }

    const { data: fresh } = await supabaseAdmin
      .from('mixers')
      .select('id, number, odometer_km, engine_hours, scout_unit_id, specs, vehicle_kind')
      .eq('id', mixerId)
      .maybeSingle();

    return NextResponse.json({
      success: true,
      mixerId,
      unitId,
      wroteSomething,
      odometer: {
        applied: odometerApplied,
        km: odometerKm,
        source: odometerSource,
      },
      drum: isMixer
        ? {
            applied: drumApplied,
            hours: engineHours,
            sensorIndex: drumSensorIndex,
            driveType,
            period,
          }
        : null,
      daily,
      messages,
      mixer: fresh,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Ошибка синхронизации паспорта СКАУТ';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
