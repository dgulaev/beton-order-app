import { NextRequest, NextResponse } from 'next/server';
import { requireCronAuth } from '@/lib/cronAuth';
import { syncScoutDailySensors } from '@/lib/integrations/scout/dailySensors';
import { isScoutConfigured, getMissingScoutEnvKeys } from '@/lib/integrations/scout';

/** Флот × SPIK-поллы — нужен запас по времени (Hobby/Pro). */
export const maxDuration = 300;

/**
 * Раз в сутки: одометр, моточасы бочки за день, ДУТ → БД (+ одометр в паспорт).
 * Расписание: 23:50 МСК (vercel 50 20 UTC; local crontab 50 23 * * *).
 * Cutover local — задуманный интервал: scripts/cron-schedules.md + план Mac mini Фаза 4.
 */
export async function GET(req: NextRequest) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  if (!isScoutConfigured()) {
    return NextResponse.json({
      success: true,
      skipped: true,
      reason: `SCOUT_* не заданы (${getMissingScoutEnvKeys().join(', ') || 'все'})`,
    });
  }

  try {
    const force = req.nextUrl.searchParams.get('force') === '1';
    const result = await syncScoutDailySensors({ force });
    return NextResponse.json({ success: result.ok, ...result });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[cron scout-sensors-daily]', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
