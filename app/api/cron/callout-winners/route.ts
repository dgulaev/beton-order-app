import { NextRequest, NextResponse } from 'next/server';
import { requireCronAuth } from '@/lib/cronAuth';
import { runCalloutWinnerPoll } from '@/lib/callout/calloutService';

export const maxDuration = 300;

/** Ежедневный опрос реестра контрактов ЕИС (победители под обзвон). */
export async function GET(req: NextRequest) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  try {
    // Небольшой batch: ГосПлан медленный, иначе serverless не успевает
    const result = await runCalloutWinnerPoll(12);
    return NextResponse.json({
      success: result.errors.length === 0,
      ...result,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Ошибка';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
