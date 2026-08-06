import { NextRequest, NextResponse } from 'next/server';
import { requireAdminCifraStaff } from '@/lib/adminCifraAuth';
import { defaultCostPeriod } from '@/lib/fleetCosts';
import { buildFuelRecon } from '@/lib/fuelRecon';
import { fleetTableMissingMessage } from '@/lib/fleetDocumentsServer';

/** GET ?from=&to=&vehicle_kind= — сверка Benza ↔ СКАУТ + pending. */
export async function GET(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request);
  if (auth.error) return auth.error;

  try {
    const defaults = defaultCostPeriod();
    const from = request.nextUrl.searchParams.get('from') || defaults.from;
    const to = request.nextUrl.searchParams.get('to') || defaults.to;
    const vehicleKind = request.nextUrl.searchParams.get('vehicle_kind');

    const data = await buildFuelRecon({ from, to, vehicleKind });
    return NextResponse.json({ success: true, ...data });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Ошибка сверки';
    return NextResponse.json(
      {
        success: false,
        error: /fuel_entries|benza/i.test(msg)
          ? fleetTableMissingMessage(msg, 'fuel_entries')
          : msg,
      },
      { status: 500 },
    );
  }
}
