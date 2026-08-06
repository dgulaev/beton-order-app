import { NextRequest, NextResponse } from 'next/server';
import { requireAdminCifraStaff } from '@/lib/adminCifraAuth';
import { buildFleetAnalytics } from '@/lib/fleetAnalytics';
import { fleetTableMissingMessage } from '@/lib/fleetDocumentsServer';

/** GET ?from=&to=&vehicle_kind= — показатели и стоимость владения за период. */
export async function GET(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request);
  if (auth.error) return auth.error;

  try {
    const from = request.nextUrl.searchParams.get('from');
    const to = request.nextUrl.searchParams.get('to');
    const vehicleKind = request.nextUrl.searchParams.get('vehicle_kind');

    const data = await buildFleetAnalytics({ from, to, vehicleKind });
    return NextResponse.json({ success: true, ...data });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Ошибка аналитики';
    return NextResponse.json(
      {
        success: false,
        error: /fuel_entries|fleet_expenses|fleet_service/i.test(msg)
          ? fleetTableMissingMessage(msg, 'fuel_entries')
          : msg,
      },
      { status: 500 },
    );
  }
}
