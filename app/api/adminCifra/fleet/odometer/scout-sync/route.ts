import { NextRequest, NextResponse } from 'next/server';
import { FLEET_MUTATION_ROLES, requireAdminCifraStaff } from '@/lib/adminCifraAuth';
import {
  getMissingScoutEnvKeys,
  isScoutConfigured,
  scoutFetchLatestOdometerKmWithFallback,
  scoutFetchPeriodMileageKm,
} from '@/lib/integrations/scout';
import { defaultFuelHistoryPeriod } from '@/lib/fleetCosts';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

/**
 * POST { mixer_id, apply?, force?, include_period_mileage? }
 * — прочитать одометр из СКАУТ (/spic/Odometer) и опционально записать в mixers.odometer_km.
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
    const force = Boolean(body.force);
    const includePeriod = body.include_period_mileage !== false;

    if (!Number.isFinite(mixerId) || mixerId <= 0) {
      return NextResponse.json({ success: false, error: 'mixer_id обязателен' }, { status: 400 });
    }

    const { data: mixer, error: mixerErr } = await supabaseAdmin
      .from('mixers')
      .select('id, number, odometer_km, scout_unit_id')
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
          error: `У «${mixer.number}» нет привязки СКАУТ (scout_unit_id)`,
        },
        { status: 400 },
      );
    }

    const reading = await scoutFetchLatestOdometerKmWithFallback({ unitId });
    const current =
      mixer.odometer_km != null && Number.isFinite(Number(mixer.odometer_km))
        ? Number(mixer.odometer_km)
        : null;

    let periodMileage: Awaited<ReturnType<typeof scoutFetchPeriodMileageKm>> | null = null;
    if (includePeriod) {
      const period = defaultFuelHistoryPeriod();
      try {
        periodMileage = await scoutFetchPeriodMileageKm({
          unitId,
          fromYmd: period.from,
          toYmd: period.to,
        });
      } catch {
        periodMileage = null;
      }
    }

    let applied = false;
    let skippedReason: string | null = null;
    let newOdometer = current;

    if (reading.mileageKm == null) {
      skippedReason =
        reading.error === 'NoSensor'
          ? 'В СКАУТ нет датчика одометра / CAN TotalMileage для этой ТС'
          : reading.error === 'NoData'
            ? 'Нет данных одометра за последние дни (терминал ещё не выгрузил или датчик пуст)'
            : reading.error || 'Нет показаний одометра';
    } else if (!apply) {
      skippedReason = 'apply=false';
    } else if (!force && current != null && reading.mileageKm + 0.05 < current) {
      skippedReason = `Показание СКАУТ (${reading.mileageKm}) меньше текущего (${current}) — не перезаписываю. Можно force=true.`;
    } else {
      const { error: upErr } = await supabaseAdmin
        .from('mixers')
        .update({
          odometer_km: reading.mileageKm,
          updated_at: new Date().toISOString(),
        })
        .eq('id', mixerId);
      if (upErr) throw new Error(upErr.message);
      applied = true;
      newOdometer = reading.mileageKm;
    }

    return NextResponse.json({
      success: true,
      mixerId,
      unitId,
      reading,
      periodMileage,
      previousOdometerKm: current,
      odometerKm: newOdometer,
      applied,
      skippedReason,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Ошибка одометра СКАУТ';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
