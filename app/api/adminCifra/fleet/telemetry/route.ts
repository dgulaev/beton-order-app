import { NextRequest, NextResponse } from 'next/server';
import { requireAdminCifraStaff } from '@/lib/adminCifraAuth';
import { fleetTableMissingMessage } from '@/lib/fleetDocumentsServer';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

function isTelemetrySchemaError(message: string): boolean {
  return /fleet_telemetry_snapshots|schema cache|relation.*does not exist/i.test(message);
}

/** GET — телематика (?mixer_id= или без параметра — все snapshots) */
export async function GET(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request);
  if (auth.error) return auth.error;

  const mixerIdParam = request.nextUrl.searchParams.get('mixer_id');

  if (mixerIdParam) {
    const id = Number(mixerIdParam);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ success: false, error: 'Некорректный mixer_id' }, { status: 400 });
    }
    const { data, error } = await supabaseAdmin
      .from('fleet_telemetry_snapshots')
      .select('*')
      .eq('mixer_id', id)
      .maybeSingle();
    if (error) {
      console.error('[fleet/telemetry GET single]', error.message);
      if (isTelemetrySchemaError(error.message)) {
        return NextResponse.json({
          success: true,
          telemetry: null,
          warning: fleetTableMissingMessage(error.message, 'fleet_telemetry_snapshots'),
        });
      }
      return NextResponse.json(
        {
          success: false,
          error: fleetTableMissingMessage(error.message, 'fleet_telemetry_snapshots'),
        },
        { status: 500 },
      );
    }
    return NextResponse.json({ success: true, telemetry: data ?? null });
  }

  const { data, error } = await supabaseAdmin.from('fleet_telemetry_snapshots').select('*');
  if (error) {
    console.error('[fleet/telemetry GET all]', error.message);
    if (isTelemetrySchemaError(error.message)) {
      return NextResponse.json({
        success: true,
        telemetry: [],
        warning: fleetTableMissingMessage(error.message, 'fleet_telemetry_snapshots'),
      });
    }
    return NextResponse.json(
      {
        success: false,
        error: fleetTableMissingMessage(error.message, 'fleet_telemetry_snapshots'),
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true, telemetry: data ?? [] });
}
