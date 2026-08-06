import { NextRequest, NextResponse } from 'next/server';
import { syncScoutTelemetry } from '@/lib/integrations/scout';
import { requireCronAuth } from '@/lib/cronAuth';

/**
 * GPS СКАУТ → fleet_telemetry_snapshots.
 * Задумано: каждые 2 мин (crontab: каждые 2 мин, МСК) — обязательно на local/Mac mini (Фаза 4).
 * На Vercel Hobby в vercel.json нет (лимит 1×/сутки) — до cutover: lib/localCrons.ts / crontab.
 * См. scripts/cron-schedules.md
 */
export const maxDuration = 60;
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
