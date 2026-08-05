import { NextRequest, NextResponse } from 'next/server';
import { requireAdminCifraStaff } from '@/lib/adminCifraAuth';
import {
  computeFleetCostPeriod,
  defaultCostPeriod,
} from '@/lib/fleetCosts';
import { fleetTableMissingMessage } from '@/lib/fleetDocumentsServer';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

/**
 * GET — стоимость 1 км и норма vs факт за период.
 * ?mixer_id=&from=&to=
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request);
  if (auth.error) return auth.error;

  const mixerId = Number(request.nextUrl.searchParams.get('mixer_id'));
  if (!Number.isFinite(mixerId) || mixerId <= 0) {
    return NextResponse.json({ success: false, error: 'mixer_id обязателен' }, { status: 400 });
  }

  const defaults = defaultCostPeriod();
  const from = request.nextUrl.searchParams.get('from') || defaults.from;
  const to = request.nextUrl.searchParams.get('to') || defaults.to;

  const { data: mixer } = await supabaseAdmin
    .from('mixers')
    .select('id, odometer_km, specs')
    .eq('id', mixerId)
    .maybeSingle();

  if (!mixer) {
    return NextResponse.json({ success: false, error: 'ТС не найдено' }, { status: 404 });
  }

  const specs = (mixer.specs && typeof mixer.specs === 'object'
    ? mixer.specs
    : {}) as Record<string, unknown>;
  const fuelNorm =
    specs.fuel_norm_l_per_100km != null
      ? Number(specs.fuel_norm_l_per_100km)
      : null;

  const [fuelRes, expRes, svcRes] = await Promise.all([
    supabaseAdmin
      .from('fuel_entries')
      .select('liters, amount_rub, odometer_km, filled_at, fuel_type')
      .eq('mixer_id', mixerId)
      .gte('filled_at', `${from}T00:00:00+03:00`)
      .lte('filled_at', `${to}T23:59:59.999+03:00`),
    supabaseAdmin
      .from('fleet_expenses')
      .select('amount_rub')
      .eq('mixer_id', mixerId)
      .gte('expense_date', from)
      .lte('expense_date', to),
    supabaseAdmin
      .from('fleet_service_records')
      .select('labor_cost, parts_cost, odometer_km, service_date, status')
      .eq('mixer_id', mixerId)
      .eq('status', 'done')
      .gte('service_date', from)
      .lte('service_date', to),
  ]);

  // Таблицы могут отсутствовать до SQL — не валим весь ответ
  const fuelErr = fuelRes.error;
  if (fuelErr && /fuel_entries/i.test(fuelErr.message)) {
    return NextResponse.json(
      {
        success: false,
        error: fleetTableMissingMessage(fuelErr.message, 'fuel_entries'),
      },
      { status: 500 },
    );
  }

  const fuelRows = fuelRes.data ?? [];
  const expRows = expRes.error ? [] : expRes.data ?? [];
  const svcRows = svcRes.error ? [] : svcRes.data ?? [];

  let fuelRub = 0;
  let fuelLiters = 0;
  const odometerReadings: number[] = [];

  for (const f of fuelRows) {
    // Сливы из СКАУТ (fuel_type=drain) не считаем в «заправлено» / л/100км
    if (String(f.fuel_type || '') === 'drain') continue;
    fuelLiters += Number(f.liters) || 0;
    fuelRub += Number(f.amount_rub) || 0;
    if (f.odometer_km != null && Number.isFinite(Number(f.odometer_km))) {
      odometerReadings.push(Number(f.odometer_km));
    }
  }

  let expensesRub = 0;
  for (const e of expRows) {
    expensesRub += Number(e.amount_rub) || 0;
  }

  let serviceRub = 0;
  for (const s of svcRows) {
    serviceRub += (Number(s.labor_cost) || 0) + (Number(s.parts_cost) || 0);
    if (s.odometer_km != null && Number.isFinite(Number(s.odometer_km))) {
      odometerReadings.push(Number(s.odometer_km));
    }
  }

  if (mixer.odometer_km != null && Number.isFinite(Number(mixer.odometer_km))) {
    odometerReadings.push(Number(mixer.odometer_km));
  }

  const period = computeFleetCostPeriod({
    from,
    to,
    fuelRub,
    fuelLiters,
    serviceRub,
    expensesRub,
    odometerReadings,
    fuelNormLPer100km: fuelNorm,
  });

  return NextResponse.json({ success: true, period });
}
