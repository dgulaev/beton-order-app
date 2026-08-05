import { NextRequest, NextResponse } from 'next/server';
import { requireAdminCifraStaff } from '@/lib/adminCifraAuth';
import {
  getScoutConfigFromEnv,
  isScoutConfigured,
  scoutGetAllUnits,
  scoutLogin,
} from '@/lib/integrations/scout';

/** GET — список объектов СКАУТ для UI маппинга */
export async function GET(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request);
  if (auth.error) return auth.error;

  if (!isScoutConfigured()) {
    return NextResponse.json({ success: true, configured: false, units: [] });
  }

  try {
    const config = getScoutConfigFromEnv()!;
    const sessionId = await scoutLogin(config);
    const resp = await scoutGetAllUnits(config, sessionId);
    return NextResponse.json({
      success: true,
      configured: true,
      units: resp.Units ?? [],
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
