import { NextRequest, NextResponse } from 'next/server';
import { syncScoutTelemetry } from '@/lib/integrations/scout';
import { requireCronAuth } from '@/lib/cronAuth';

/** Vercel Cron / локальный curl — синхронизация СКАУТ каждые 2 мин */
export async function GET(req: NextRequest) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  try {
    const result = await syncScoutTelemetry();
    return NextResponse.json({ success: result.ok, ...result });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[cron scout-sync]', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
