import { NextRequest, NextResponse } from 'next/server';
import { FLEET_MUTATION_ROLES, requireAdminCifraStaff } from '@/lib/adminCifraAuth';
import { resolveDrumDriveType } from '@/lib/fleetDrumDrive';
import {
  getMissingScoutEnvKeys,
  guessMixerDrumHours,
  isScoutConfigured,
  scoutFetchDiscreteSensors,
  scoutFetchDiscreteSensorsWithFallback,
  scoutFetchMotorModes,
} from '@/lib/integrations/scout';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

/**
 * POST { mixer_id, apply?, from?, to? }
 * — моточасы бочки из DiscreteSensor за период → mixers.engine_hours.
 *
 * СКАУТ не отдаёт заводской абсолютный счётчик бочки: считаем часы «вкл»
 * дискрета. По умолчанию 7→30→90 суток (YTD на сервере часто без Points).
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
    const apply = body.apply !== false;
    const fromRaw = body.from != null ? String(body.from).slice(0, 10) : '';
    const toRaw = body.to != null ? String(body.to).slice(0, 10) : '';
    const useExplicitPeriod =
      /^\d{4}-\d{2}-\d{2}$/.test(fromRaw) && /^\d{4}-\d{2}-\d{2}$/.test(toRaw);

    if (!Number.isFinite(mixerId) || mixerId <= 0) {
      return NextResponse.json({ success: false, error: 'mixer_id обязателен' }, { status: 400 });
    }
    if ((body.from != null || body.to != null) && !useExplicitPeriod) {
      return NextResponse.json({ success: false, error: 'from/to — YYYY-MM-DD' }, { status: 400 });
    }

    const { data: mixer, error: mixerErr } = await supabaseAdmin
      .from('mixers')
      .select('id, number, vehicle_kind, engine_hours, scout_unit_id, specs')
      .eq('id', mixerId)
      .maybeSingle();

    if (mixerErr || !mixer) {
      return NextResponse.json({ success: false, error: 'ТС не найдено' }, { status: 404 });
    }

    const vehicleKind = String(mixer.vehicle_kind || 'mixer');
    if (vehicleKind !== 'mixer') {
      return NextResponse.json(
        { success: false, error: 'Моточасы бочки только для миксеров' },
        { status: 400 },
      );
    }

    const unitId = mixer.scout_unit_id != null ? Number(mixer.scout_unit_id) : NaN;
    if (!Number.isFinite(unitId) || unitId <= 0) {
      return NextResponse.json(
        {
          success: false,
          error: `У «${mixer.number}» нет привязки СКАУТ (scout_unit_id)`,
        },
        { status: 400 },
      );
    }

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

    const discrete = useExplicitPeriod
      ? await (async () => {
          const period =
            fromRaw <= toRaw
              ? { from: fromRaw, to: toRaw }
              : { from: toRaw, to: fromRaw };
          const stats = await scoutFetchDiscreteSensors({
            unitId,
            fromIso: `${period.from}T00:00:00+03:00`,
            toIso: `${period.to}T23:59:59.999+03:00`,
          });
          return {
            ...stats,
            fromYmd: period.from,
            toYmd: period.to,
            windowDays: 0,
          };
        })()
      : await scoutFetchDiscreteSensorsWithFallback({ unitId });

    const period = { from: discrete.fromYmd, to: discrete.toYmd };
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

    const previous =
      mixer.engine_hours != null && Number.isFinite(Number(mixer.engine_hours))
        ? Number(mixer.engine_hours)
        : null;

    let applied = false;
    let skippedReason: string | null = null;
    let engineHours = previous;

    if (guess.drumOnHours == null) {
      skippedReason = guess.note || 'Не удалось выделить канал бочки';
    } else if (!apply) {
      skippedReason = 'apply=false';
    } else {
      const hours = Math.round(guess.drumOnHours * 100) / 100;
      const { error: upErr } = await supabaseAdmin
        .from('mixers')
        .update({
          engine_hours: hours,
          updated_at: new Date().toISOString(),
          specs: {
            ...specs,
            drum_drive_type: driveType,
            ...(preferredSensorIndex != null
              ? { scout_drum_sensor_index: preferredSensorIndex }
              : guess.sensorIndex != null
                ? { scout_drum_sensor_index: guess.sensorIndex }
                : {}),
            scout_drum_hours_from: period.from,
            scout_drum_hours_to: period.to,
          },
        })
        .eq('id', mixerId);
      if (upErr) throw new Error(upErr.message);
      applied = true;
      engineHours = hours;
    }

    return NextResponse.json({
      success: true,
      mixerId,
      unitId,
      period,
      driveType,
      guess,
      previousEngineHours: previous,
      engineHours,
      applied,
      skippedReason,
      note:
        'Это сумма часов работы дискрета бочки за период (не заводской абсолютный счётчик).',
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Ошибка моточасов бочки СКАУТ';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
