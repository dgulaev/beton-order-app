// app/api/adminCifra/travel-time/route.ts
// Рассчитывает время в пути от завода до адреса доставки.
// Результат сохраняется в orders.road_time_min (кэш в БД).
//
// Формула v3 — см. lib/travelTime.ts (самовывоз = 0, ЖК/Ходаринка через normalize).
// После смены формулы кэш сбрасывают через force: true или batch+force.
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  TRAVEL_FORMULA_VERSION,
  computeRoadMinutes,
} from '@/lib/travelTime';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export { TRAVEL_FORMULA_VERSION };

async function resolveOne(
  orderId: number,
  address: string | null | undefined,
  force: boolean,
): Promise<{
  orderId: number;
  road_time_min: number;
  source: 'calculated' | 'cached' | 'fallback';
}> {
  if (!force) {
    const { data: existing } = await supabase
      .from('orders')
      .select('road_time_min')
      .eq('id', orderId)
      .single();

    if (existing?.road_time_min !== null && existing?.road_time_min !== undefined) {
      return {
        orderId,
        road_time_min: existing.road_time_min,
        source: 'cached',
      };
    }
  }

  const { road_time_min, source } = await computeRoadMinutes(address);
  await supabase.from('orders').update({ road_time_min }).eq('id', orderId);
  return { orderId, road_time_min, source };
}

/**
 * POST /api/adminCifra/travel-time
 *
 * Один: { orderId, address, force? }
 * Пакет (сброс кэша дня): { batch: [{ orderId, address }], force: true }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const force = Boolean(body.force);

    if (Array.isArray(body.batch)) {
      const batch = body.batch as Array<{ orderId?: number; address?: string }>;
      if (!batch.length) {
        return NextResponse.json({ error: 'batch пуст' }, { status: 400 });
      }
      const times: Record<string, number> = {};
      const sources: Record<string, string> = {};
      // Последовательно — не долбим DaData параллельно.
      for (const item of batch) {
        const orderId = Number(item.orderId);
        if (!Number.isFinite(orderId)) continue;
        const row = await resolveOne(orderId, item.address, force);
        times[String(orderId)] = row.road_time_min;
        sources[String(orderId)] = row.source;
      }
      return NextResponse.json({
        times,
        sources,
        formulaVersion: TRAVEL_FORMULA_VERSION,
        forced: force,
      });
    }

    const orderId = Number(body.orderId);
    if (!Number.isFinite(orderId)) {
      return NextResponse.json({ error: 'orderId обязателен' }, { status: 400 });
    }

    const row = await resolveOne(orderId, body.address, force);
    return NextResponse.json({
      road_time_min: row.road_time_min,
      source: row.source,
      formulaVersion: TRAVEL_FORMULA_VERSION,
    });
  } catch (err: any) {
    console.error('travel-time error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * GET /api/adminCifra/travel-time?orderId=123
 */
export async function GET(req: NextRequest) {
  const orderId = req.nextUrl.searchParams.get('orderId');
  if (!orderId) return NextResponse.json({ road_time_min: null });

  const { data } = await supabase
    .from('orders')
    .select('road_time_min')
    .eq('id', parseInt(orderId, 10))
    .single();

  return NextResponse.json({ road_time_min: data?.road_time_min ?? null });
}
