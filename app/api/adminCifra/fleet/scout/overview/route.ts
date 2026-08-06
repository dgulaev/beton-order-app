import { NextRequest, NextResponse } from 'next/server';
import { requireAdminCifraStaff } from '@/lib/adminCifraAuth';
import { defaultFuelHistoryPeriod } from '@/lib/fleetCosts';
import { resolveDrumDriveType } from '@/lib/fleetDrumDrive';
import {
  getMissingScoutEnvKeys,
  isScoutConfigured,
  scoutFetchUnitOverview,
} from '@/lib/integrations/scout';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

/** GET ?mixer_id=&from=&to= — всё доступное из СКАУТ по ТС за период. */
export async function GET(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request);
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
    const mixerId = Number(request.nextUrl.searchParams.get('mixer_id'));
    const defaults = defaultFuelHistoryPeriod();
    const from = (request.nextUrl.searchParams.get('from') || defaults.from).slice(0, 10);
    const to = (request.nextUrl.searchParams.get('to') || defaults.to).slice(0, 10);

    if (!Number.isFinite(mixerId) || mixerId <= 0) {
      return NextResponse.json({ success: false, error: 'mixer_id обязателен' }, { status: 400 });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return NextResponse.json({ success: false, error: 'from/to — YYYY-MM-DD' }, { status: 400 });
    }

    const { data: mixer, error } = await supabaseAdmin
      .from('mixers')
      .select('id, number, scout_unit_id, odometer_km, engine_hours, vehicle_kind, specs')
      .eq('id', mixerId)
      .maybeSingle();

    if (error || !mixer) {
      return NextResponse.json({ success: false, error: 'ТС не найдено' }, { status: 404 });
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

    const vehicleKind = String(mixer.vehicle_kind || 'mixer');
    const isMixer = vehicleKind === 'mixer';
    const specs =
      mixer.specs && typeof mixer.specs === 'object' && !Array.isArray(mixer.specs)
        ? (mixer.specs as Record<string, unknown>)
        : {};
    const drumIdxRaw = specs.scout_drum_sensor_index;
    const drumSensorIndex =
      drumIdxRaw != null && drumIdxRaw !== '' && Number.isFinite(Number(drumIdxRaw))
        ? Number(drumIdxRaw)
        : null;
    const drumDriveType = resolveDrumDriveType(String(mixer.number || ''), specs);

    const period = from <= to ? { from, to } : { from: to, to: from };
    const overview = await scoutFetchUnitOverview({
      unitId,
      fromYmd: period.from,
      toYmd: period.to,
      isMixer,
      drumDriveType,
      drumSensorIndex,
    });

    return NextResponse.json({
      success: true,
      mixer: {
        id: mixer.id,
        number: mixer.number,
        vehicle_kind: vehicleKind,
        drum_drive_type: drumDriveType,
        odometer_km: mixer.odometer_km,
        engine_hours: mixer.engine_hours,
        scout_unit_id: unitId,
      },
      overview,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Ошибка обзора СКАУТ';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
