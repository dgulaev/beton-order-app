import { NextRequest, NextResponse } from 'next/server';
import { requireCronAuth } from '@/lib/cronAuth';
import { syncCompetitorsCatalog } from '@/lib/competitors/syncCatalog';

/**
 * Ежедневный крон: upsert каталога + парсинг прайсов с сайтов конкурентов.
 *
 * Расписание: 10:00 МСК (vercel 0 7 UTC; local crontab 0 10 * * *).
 * Cutover local — задуманный интервал: scripts/cron-schedules.md
 */
export async function GET(req: NextRequest) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  try {
    const result = await syncCompetitorsCatalog({ parsePrices: true });
    return NextResponse.json({
      success: true,
      ...result,
      at: new Date().toISOString(),
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
