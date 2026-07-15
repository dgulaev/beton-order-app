// app/api/adminCifra/travel-time/route.ts
// Рассчитывает время в пути от завода до адреса доставки.
// Алгоритм: геокодирование DaData → расстояние по Хаверсину → оценка
// времени с учётом коэффициента дороги и средней городской скорости.
// Результат сохраняется в orders.road_time_min (кэш в БД).
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Координаты завода — Брянск, Орловский тупик, 6
const PLANT_LAT = 53.25347;
const PLANT_LON = 34.416444;

// Коэффициент дороги: реальное расстояние по дорогам ≈ прямолинейное × 1.35
const ROUTING_FACTOR = 1.35;
// Средняя скорость с учётом выезда из города + трасса (км/ч).
// Яндекс показывает 87км/95мин для маршрута где Хаверсин даёт ~62км — 
// это ~55км/ч реально. Берём 50км/ч как консервативный буфер.
const AVG_SPEED_KMH = 50;
// Минимальное время в пути (даже для близких объектов — погрузка/выезд с завода)
const MIN_TRAVEL_MIN = 10;
// Если адрес не геокодируется — используем среднее для района Брянска
const FALLBACK_TRAVEL_MIN = 30;

/** Формула Хаверсина: расстояние между двумя точками на сфере (в км). */
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

/**
 * Пытается извлечь координаты прямо из текста адреса —
 * диспетчеры иногда вставляют "52.735700, 34.774616" в поле адреса.
 * Это точнее любого геокодирования.
 */
function extractCoordsFromText(address: string): { lat: number; lon: number } | null {
  const match = address.match(/(\d{2,3}\.\d{3,})[,\s]+(\d{2,3}\.\d{3,})/);
  if (!match) return null;
  const lat = parseFloat(match[1]);
  const lon = parseFloat(match[2]);
  // Санитарная проверка: координаты должны быть в разумном диапазоне для России
  if (lat >= 41 && lat <= 82 && lon >= 19 && lon <= 170) {
    return { lat, lon };
  }
  return null;
}

/** Геокодирует адрес: сначала ищет координаты в тексте, затем DaData. */
async function geocode(address: string): Promise<{ lat: number; lon: number } | null> {
  // Приоритет: координаты, встроенные в текст адреса
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

/**
 * POST /api/adminCifra/travel-time
 * Body: { orderId: number, address: string }
 * Returns: { road_time_min: number, source: 'calculated' | 'cached' | 'fallback' }
 */
export async function POST(req: NextRequest) {
  try {
    const { orderId, address, force } = await req.json();

    if (!orderId) {
      return NextResponse.json({ error: 'orderId обязателен' }, { status: 400 });
    }

    // Проверяем кэш в БД (пропускаем если force=true — принудительный пересчёт)
    if (!force) {
      const { data: existing } = await supabase
        .from('orders')
        .select('road_time_min')
        .eq('id', orderId)
        .single();

      if (existing?.road_time_min !== null && existing?.road_time_min !== undefined) {
        return NextResponse.json({
          road_time_min: existing.road_time_min,
          source: 'cached',
        });
      }
    }

    // Нет кэша — считаем
    let road_time_min = FALLBACK_TRAVEL_MIN;
    let source: 'calculated' | 'fallback' = 'fallback';

    if (address && address.trim()) {
      const coords = await geocode(address.trim());
      if (coords) {
        const straightKm = haversineKm(PLANT_LAT, PLANT_LON, coords.lat, coords.lon);
        const roadKm = straightKm * ROUTING_FACTOR;
        const estimatedMin = Math.round((roadKm / AVG_SPEED_KMH) * 60);
        road_time_min = Math.max(MIN_TRAVEL_MIN, estimatedMin);
        source = 'calculated';
      }
    }

    // Сохраняем в БД
    await supabase
      .from('orders')
      .update({ road_time_min })
      .eq('id', orderId);

    return NextResponse.json({ road_time_min, source });
  } catch (err: any) {
    console.error('travel-time error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * GET /api/adminCifra/travel-time?orderId=123
 * Возвращает только сохранённое значение (без пересчёта).
 */
export async function GET(req: NextRequest) {
  const orderId = req.nextUrl.searchParams.get('orderId');
  if (!orderId) return NextResponse.json({ road_time_min: null });

  const { data } = await supabase
    .from('orders')
    .select('road_time_min')
    .eq('id', parseInt(orderId))
    .single();

  return NextResponse.json({ road_time_min: data?.road_time_min ?? null });
}
