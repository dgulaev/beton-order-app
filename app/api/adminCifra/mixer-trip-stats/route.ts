import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { FLEET_HISTORY_DAYS } from '@/lib/logisticsPlanner';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

/**
 * GET — частота завершённых рейсов по имени миксера за последние N дней.
 * Для ранжирования парка в интеллектуальном планировании.
 */
export async function GET(request: NextRequest) {
  try {
    const daysParam = Number(request.nextUrl.searchParams.get('days') || FLEET_HISTORY_DAYS);
    const days = Number.isFinite(daysParam)
      ? Math.min(180, Math.max(7, Math.round(daysParam)))
      : FLEET_HISTORY_DAYS;

    const since = new Date();
    since.setDate(since.getDate() - days);
    const sinceIso = since.toISOString();

    const { data, error } = await supabase
      .from('order_mixers')
      .select('mixer_name, volume, status, created_at')
      .eq('status', 'Разгружен')
      .gte('created_at', sinceIso)
      .limit(20000);

    if (error) throw error;

    const byName = new Map<string, { tripCount: number; volumeSum: number }>();
    for (const row of data || []) {
      const name = String(row.mixer_name || '').trim();
      if (!name) continue;
      const prev = byName.get(name) || { tripCount: 0, volumeSum: 0 };
      prev.tripCount += 1;
      prev.volumeSum += Number(row.volume) || 0;
      byName.set(name, prev);
    }

    const stats: Record<string, { tripCount: number; volumeSum: number }> = {};
    for (const [name, v] of byName) {
      stats[name] = {
        tripCount: v.tripCount,
        volumeSum: Math.round(v.volumeSum * 10) / 10,
      };
    }

    return NextResponse.json({ days, stats });
  } catch (err: any) {
    console.error('[mixer-trip-stats]', err);
    return NextResponse.json(
      { error: err?.message || 'stats failed', stats: {} },
      { status: 500 },
    );
  }
}
