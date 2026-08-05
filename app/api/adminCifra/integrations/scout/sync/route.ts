import { NextRequest, NextResponse } from 'next/server';
import { FLEET_MUTATION_ROLES, requireAdminCifraStaff } from '@/lib/adminCifraAuth';
import { requireCronAuth } from '@/lib/cronAuth';
import { syncScoutTelemetry } from '@/lib/integrations/scout';

async function runSync(request: NextRequest) {
  const cronDenied = requireCronAuth(request);
  if (cronDenied) {
    const auth = await requireAdminCifraStaff(request, FLEET_MUTATION_ROLES);
    if (auth.error) return auth.error;
  }

  try {
    const result = await syncScoutTelemetry();
    return NextResponse.json({ success: result.ok, ...result });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[scout sync]', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

/** POST — синхронизация: cron (CRON_SECRET) или staff adminCifra */
export async function POST(request: NextRequest) {
  return runSync(request);
}

/** GET — для Vercel Cron */
export async function GET(request: NextRequest) {
  return runSync(request);
}
