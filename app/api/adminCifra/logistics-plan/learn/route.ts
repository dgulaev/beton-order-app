/**
 * V2: обучение на истории план↔факт.
 * POST { date?, days?, backfill? }
 *  - date — пересчитать один день
 *  - backfill: true — 45 дней + пересчёт калибровки
 */
import { NextRequest, NextResponse } from 'next/server';
import { PLANNER_EDIT_ROLES, requireAdminCifraStaff } from '@/lib/adminCifraAuth';
import { normalizePlanDateKey } from '@/lib/dailyLogisticsPlan';
import { PLANNER_LEARN_DAYS } from '@/lib/plannerCalibration';
import {
  backfillLearn,
  learnDay,
  recomputeCalibration,
} from '@/lib/plannerLearn';

export async function POST(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request, PLANNER_EDIT_ROLES);
  if (auth.error) return auth.error;

  let body: { date?: string; days?: number; backfill?: boolean } = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  try {
    if (body.backfill) {
      const days = Math.min(
        90,
        Math.max(7, Math.round(Number(body.days) || PLANNER_LEARN_DAYS)),
      );
      const result = await backfillLearn(days);
      return NextResponse.json({
        ok: true,
        mode: 'backfill',
        days: result.days.length,
        learned: result.results.filter((r) => r.upserted > 0).length,
        errors: result.results.filter((r) => r.error).length,
        results: result.results,
        calibration: result.calibration,
      });
    }

    const date = normalizePlanDateKey(String(body.date || ''));
    if (!date) {
      return NextResponse.json(
        { error: 'Укажи date=YYYY-MM-DD или backfill: true' },
        { status: 400 },
      );
    }

    const day = await learnDay(date);
    const calibration = await recomputeCalibration(PLANNER_LEARN_DAYS);
    return NextResponse.json({
      ok: true,
      mode: 'day',
      day,
      calibration,
    });
  } catch (err: any) {
    const msg = err?.message || String(err);
    if (/plan_fact_trip_metrics|planner_calibration|does not exist/i.test(msg)) {
      return NextResponse.json(
        {
          error:
            'Таблицы V2 ещё не применены. Выполни scripts/plan-fact-metrics-schema.sql в Supabase.',
          detail: msg,
        },
        { status: 503 },
      );
    }
    console.error('logistics-plan/learn:', err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
