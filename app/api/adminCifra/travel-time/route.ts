// app/api/adminCifra/travel-time/route.ts
// Рассчитывает время в пути от завода до адреса доставки.
// Алгоритм: геокодирование DaData → расстояние по Хаверсину → оценка
// времени с учётом коэффициента дороги и средней городской скорости.
// Результат сохраняется в orders.road_time_min (кэш в БД).
//
// Формула v2 (31.07.2026): кривизна 1.3, скорость 55 км/ч.
// После смены формулы кэш сбрасывают через force: true или batch+force.
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/** Версия формулы — при росте сбрасывать кэш через force. */
export const TRAVEL_FORMULA_VERSION = 2;

// Координаты завода — Брянск, Орловский тупик, 6
const PLANT_LAT = 53.25347;
const PLANT_LON = 34.416444;

// Коэффициент дороги: как в deliveryPricing (1.3).
const ROUTING_FACTOR = 1.3;
// Средняя скорость с учётом выезда из города + трасса (км/ч).
const AVG_SPEED_KMH = 55;
const MIN_TRAVEL_MIN = 10;
const FALLBACK_TRAVEL_MIN = 30;

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function extractCoordsFromText(address: string): { lat: number; lon: number } | null {
  const match = address.match(/(\d{2,3}\.\d{3,})[,\s]+(\d{2,3}\.\d{3,})/);
  if (!match) return null;
  const lat = parseFloat(match[1]);
  const lon = parseFloat(match[2]);
  if (lat >= 41 && lat <= 82 && lon >= 19 && lon <= 170) {
    return { lat, lon };
  }
  return null;
}

async function geocode(address: string): Promise<{ lat: number; lon: number } | null> {
  const fromText = extractCoordsFromText(address);
  if (fromText) return fromText;

  try {
    const base = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const res = await fetch(`${base}/api/geocode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (typeof data.lat === 'number' && typeof data.lon === 'number') {
      return { lat: data.lat, lon: data.lon };
    }
    return null;
  } catch {
    return null;
  }
}

async function computeRoadMinutes(
  address: string | null | undefined,
): Promise<{ road_time_min: number; source: 'calculated' | 'fallback' }> {
  let road_time_min = FALLBACK_TRAVEL_MIN;
  let source: 'calculated' | 'fallback' = 'fallback';
  if (address && String(address).trim()) {
    const coords = await geocode(String(address).trim());
    if (coords) {
      const straightKm = haversineKm(PLANT_LAT, PLANT_LON, coords.lat, coords.lon);
      const roadKm = straightKm * ROUTING_FACTOR;
      const estimatedMin = Math.round((roadKm / AVG_SPEED_KMH) * 60);
      road_time_min = Math.max(MIN_TRAVEL_MIN, estimatedMin);
      source = 'calculated';
    }
  }
  return { road_time_min, source };
}

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
