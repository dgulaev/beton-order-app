/**
 * V2: подсказки диспетчеру — сводка дня + текущая калибровка.
 * GET ?date=YYYY-MM-DD
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAdminCifraStaff } from '@/lib/adminCifraAuth';
import { normalizePlanDateKey } from '@/lib/dailyLogisticsPlan';
import {
  PLANNER_CALIB_MIN_SAMPLES,
  PLANNER_LEARN_DAYS,
  calibrationSummaryLabel,
  toCalibrationSourceMeta,
} from '@/lib/plannerCalibration';
import { loadCurrentCalibration } from '@/lib/plannerLearn';
import { supabaseAdmin as supabase } from '@/lib/supabaseAdmin';

function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function round1(n: number | null): number | null {
  if (n == null || !Number.isFinite(n)) return null;
  return Math.round(n * 10) / 10;
}

export async function GET(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request);
  if (auth.error) return auth.error;

  const date = normalizePlanDateKey(
    request.nextUrl.searchParams.get('date') || '',
  );
  if (!date) {
    return NextResponse.json({ error: 'Укажи date=YYYY-MM-DD' }, { status: 400 });
  }

  try {
    const calibration = await loadCurrentCalibration();
    const calibMeta = toCalibrationSourceMeta(calibration);

    const { data: metrics, error: mErr } = await supabase
      .from('plan_fact_trip_metrics')
      .select(
        'plan_trip_id, order_id, mixer_number, volume_m3, plan_load_min, fact_load_dur_min, delta_load_start_min, fact_road_min, plan_road_min, fact_onsite_min, plan_unload_min, delta_cycle_min, match_kind, snapshot_quality',
      )
      .eq('delivery_date', date);

    if (mErr) {
      if (/plan_fact_trip_metrics|does not exist/i.test(mErr.message || '')) {
        return NextResponse.json({
          date,
          ready: false,
          hint: 'Выполни scripts/plan-fact-metrics-schema.sql и POST …/learn с backfill.',
          calibration: calibMeta,
          calibrationFull: calibration,
          calibrationLabel: calibrationSummaryLabel(calibration),
          day: null,
          tips: [],
        });
      }
      throw mErr;
    }

    const rows = metrics || [];
    const matched = rows.filter((r) => r.match_kind !== 'none');
    const loadDurs = matched
      .map((r) => Number(r.fact_load_dur_min))
      .filter((n) => Number.isFinite(n) && n > 0);
    const planLoads = matched
      .map((r) => Number(r.plan_load_min))
      .filter((n) => Number.isFinite(n) && n > 0);
    const deltaStarts = matched
      .map((r) => Number(r.delta_load_start_min))
      .filter((n) => Number.isFinite(n));
    const earlyStart = deltaStarts.filter((d) => d < -5).length;
    const lateStart = deltaStarts.filter((d) => d > 5).length;

    const cycleDeltas = matched
      .map((r) => Number(r.delta_cycle_min))
      .filter((n) => Number.isFinite(n));

    const roadSlow = matched.filter((r) => {
      const fact = Number(r.fact_road_min);
      const plan = Number(r.plan_road_min);
      return Number.isFinite(fact) && Number.isFinite(plan) && plan > 0 && fact > plan * 1.25;
    });

    const onsiteLong = matched.filter((r) => {
      const fact = Number(r.fact_onsite_min);
      const plan = Number(r.plan_unload_min) || 35;
      return Number.isFinite(fact) && fact > plan + 15;
    });

    const medLoadFact = median(loadDurs);
    const medLoadPlan = median(planLoads);
    const medDeltaStart = median(deltaStarts);
    const medCycleDelta = median(cycleDeltas);

    const tips: Array<{ tone: 'tip' | 'warn' | 'ok'; text: string }> = [];

    if (matched.length === 0) {
      tips.push({
        tone: 'tip',
        text: 'Пока нет сопоставленных рейсов за этот день. Нажми «Обновить обучение» после смены или сделай backfill.',
      });
    } else {
      if (medLoadFact != null && medLoadPlan != null && medLoadFact + 1.5 < medLoadPlan) {
        tips.push({
          tone: 'ok',
          text: `Соска быстрее плана: факт ~${Math.round(medLoadFact)} мин vs план ~${Math.round(medLoadPlan)} мин. Расчёт V2 подтянет норму.`,
        });
      } else if (
        medLoadFact != null &&
        medLoadPlan != null &&
        medLoadFact > medLoadPlan + 2
      ) {
        tips.push({
          tone: 'warn',
          text: `Соска дольше плана: факт ~${Math.round(medLoadFact)} мин vs ~${Math.round(medLoadPlan)} мин.`,
        });
      }

      if (medDeltaStart != null && medDeltaStart < -5) {
        tips.push({
          tone: 'ok',
          text: `Старт загрузки раньше плана (медиана ${Math.round(medDeltaStart)} мин) — день сжимается.`,
        });
      } else if (medDeltaStart != null && medDeltaStart > 8) {
        tips.push({
          tone: 'warn',
          text: `Старт загрузки опаздывает (медиана +${Math.round(medDeltaStart)} мин). Этап подтянет хвост.`,
        });
      }

      if (medCycleDelta != null && medCycleDelta < -10) {
        tips.push({
          tone: 'ok',
          text: `Цикл рейса короче плана на ~${Math.abs(Math.round(medCycleDelta))} мин — хвост дня можно уплотнить.`,
        });
      }

      if (roadSlow.length >= 2) {
        tips.push({
          tone: 'warn',
          text: `Дорога дольше плана у ${roadSlow.length} рейс. — проверь пробки/адреса.`,
        });
      }
      if (onsiteLong.length >= 2) {
        tips.push({
          tone: 'warn',
          text: `На объекте дольше нормы у ${onsiteLong.length} рейс. — возможны простои.`,
        });
      }
    }

    if (calibMeta.active) {
      tips.push({
        tone: 'tip',
        text: calibrationSummaryLabel(calibration),
      });
    } else {
      tips.push({
        tone: 'tip',
        text: `Калибровка ещё слабая (${calibMeta.samples}/${PLANNER_CALIB_MIN_SAMPLES} рейс.). Нужен backfill за ${PLANNER_LEARN_DAYS} дн.`,
      });
    }

    return NextResponse.json({
      date,
      ready: true,
      calibration: calibMeta,
      calibrationFull: calibration,
      calibrationLabel: calibrationSummaryLabel(calibration),
      day: {
        tripCount: rows.length,
        matched: matched.length,
        earlyStartCount: earlyStart,
        lateStartCount: lateStart,
        medianLoadFactMin: round1(medLoadFact),
        medianLoadPlanMin: round1(medLoadPlan),
        medianDeltaStartMin: round1(medDeltaStart),
        medianCycleDeltaMin: round1(medCycleDelta),
        roadSlowCount: roadSlow.length,
        onsiteLongCount: onsiteLong.length,
        snapshotQuality: matched[0]?.snapshot_quality || rows[0]?.snapshot_quality || null,
      },
      tips,
      risks: [
        ...roadSlow.slice(0, 8).map((r) => ({
          kind: 'road' as const,
          orderId: r.order_id,
          mixer: r.mixer_number,
          text: `Дорога ${r.fact_road_min} мин при плане ${r.plan_road_min}`,
        })),
        ...onsiteLong.slice(0, 8).map((r) => ({
          kind: 'onsite' as const,
          orderId: r.order_id,
          mixer: r.mixer_number,
          text: `На объекте ${r.fact_onsite_min} мин`,
        })),
      ],
    });
  } catch (err: any) {
    console.error('logistics-plan/insights:', err);
    return NextResponse.json(
      { error: err?.message || 'Ошибка insights' },
      { status: 500 },
    );
  }
}
