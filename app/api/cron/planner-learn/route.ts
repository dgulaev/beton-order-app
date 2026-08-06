/**
 * Ночной пересчёт метрик и калибровки интеллекта V2.
 * Расписание: 23:20 МСК (vercel 20 20 UTC; local crontab 20 23 * * *).
 * Cutover local — задуманный интервал: scripts/cron-schedules.md
 * Защита: Authorization Bearer CRON_SECRET.
 */
import { NextRequest, NextResponse } from 'next/server';
import { PLANNER_LEARN_DAYS } from '@/lib/plannerCalibration';
import { backfillLearn } from '@/lib/plannerLearn';

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const auth = request.headers.get('authorization') || '';
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await backfillLearn(PLANNER_LEARN_DAYS);
    return NextResponse.json({
      ok: true,
      days: result.days.length,
      learned: result.results.filter((r) => r.upserted > 0).length,
      errors: result.results.filter((r) => r.error).length,
      calibration: {
        samples: result.calibration.samples,
        daysUsed: result.calibration.daysUsed,
        loadP50: result.calibration.loadP50,
        unloadP50: result.calibration.unloadP50,
      },
    });
  } catch (err: any) {
    console.error('cron/planner-learn:', err);
    return NextResponse.json(
      { error: err?.message || 'learn failed' },
      { status: 500 },
    );
  }
}
