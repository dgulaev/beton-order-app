import { NextRequest, NextResponse } from 'next/server';
import { requireCronAuth } from '@/lib/cronAuth';
import { runCalloutWinnerPoll } from '@/lib/callout/calloutService';

export const maxDuration = 300;

/**
 * Опрос реестра контрактов ЕИС для pending-закупок обзвона.
 * Расписание: vercel.json → /api/cron/callout-winners (несколько раз в сутки).
 *
 * Логика:
 * 1) вернуть в очередь часть missing/failed (реже 7 дней);
 * 2) взять N pending с winner_poll_after <= now;
 * 3) для каждой — refreshTenderWinner (ЕИС HTML → контракт → поставщик);
 * 4) если победителя нет — winner_poll_after += 3 дня, attempts++;
 *    после ~12 попыток → missing.
 */
export async function GET(req: NextRequest) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  try {
    // Малый batch: HTML ЕИС + ГосПлан, иначе serverless не успевает за 300с
    const result = await runCalloutWinnerPoll(5);
    return NextResponse.json({
      success: result.errors.length === 0,
      ...result,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Ошибка';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
