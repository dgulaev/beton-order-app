import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { ADMIN_CIFRA_STAFF_ROLES, requireAdminCifraStaff } from '@/lib/adminCifraAuth';
import { normalizeDeliveryAddress } from '@/lib/bryanskAddress';
import { recipeToMatrixCell } from '@/lib/competitors';
import {
  buildDeliveryAnalytics,
  buildOwnPlant,
  OWN_PLANT_ID,
  type PlantRef,
} from '@/lib/competitorsDeliveryAnalytics';
import { DEFAULT_DELIVERY_SETTINGS } from '@/lib/deliveryPricing';
import {
  extractCoordsFromAddress,
  geocodeAddressWithFallback,
  type Coords,
} from '@/lib/geocodeAddress';

export const maxDuration = 60;

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/** Макс. длина периода (дней), чтобы не упереться в лимит serverless / DaData. */
const MAX_RANGE_DAYS = 120;

function isDateStr(v: string | null): v is string {
  return !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, Math.max(items.length, 1)) }, async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      results[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * GET /api/adminCifra/competitors/delivery-analytics?from=&to=
 * Заявки с адресом за период → геокод → км (haversine × кривизна) и цены матрицы
 * по своему БСУ + конкурентам.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request, ADMIN_CIFRA_STAFF_ROLES);
  if (auth.error) return auth.error;

  try {
    const { searchParams } = new URL(request.url);
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    if (!isDateStr(from) || !isDateStr(to)) {
      return NextResponse.json({ error: 'Нужны from и to в формате YYYY-MM-DD' }, { status: 400 });
    }
    if (from > to) {
      return NextResponse.json({ error: 'from не может быть позже to' }, { status: 400 });
    }
    const fromMs = Date.parse(`${from}T00:00:00Z`);
    const toMs = Date.parse(`${to}T00:00:00Z`);
    const rangeDays = Math.floor((toMs - fromMs) / 86400000) + 1;
    if (!Number.isFinite(rangeDays) || rangeDays > MAX_RANGE_DAYS) {
      return NextResponse.json(
        { error: `Период слишком длинный — максимум ${MAX_RANGE_DAYS} дней` },
        { status: 400 },
      );
    }

    const [{ data: ordersRaw, error: ordersErr }, { data: competitors }, { data: snaps }, { data: recipes }, { data: deliveryRow }] =
      await Promise.all([
        supabase
          .from('orders')
          .select('id, address, grade, volume, delivery_date, organization_name, full_name, status, order_type')
          .gte('delivery_date', from)
          .lte('delivery_date', to)
          .neq('status', 'cancelled')
          .not('address', 'is', null)
          .order('delivery_date', { ascending: false })
          .limit(3000),
        supabase
          .from('competitors')
          .select('id, name, short_name, lat, lon, active')
          .eq('active', true),
        supabase
          .from('competitor_price_snapshots')
          .select('competitor_id, grade_key, filler, price, parsed_at')
          .order('parsed_at', { ascending: false })
          .limit(5000),
        supabase.from('recipes').select('code, price, type, item_type, name, is_active'),
        supabase.from('delivery_settings').select('road_curvature_coefficient').eq('id', 1).maybeSingle(),
      ]);

    if (ordersErr) {
      console.error('delivery-analytics orders', ordersErr);
      return NextResponse.json({ error: 'Не удалось загрузить заявки' }, { status: 500 });
    }

    const orders = (ordersRaw || []).filter((o) => {
      const addr = String(o.address || '').trim();
      if (!addr) return false;
      const ot = String(o.order_type || 'concrete');
      return ot !== 'bulk';
    });

    const plants: PlantRef[] = [buildOwnPlant()];
    for (const c of competitors || []) {
      const lat = Number(c.lat);
      const lon = Number(c.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      plants.push({
        id: String(c.id),
        name: String(c.short_name || c.name || `Конкурент ${c.id}`),
        lat,
        lon,
        isOwn: false,
      });
    }

    // Цены: own + competitors
    const prices = new Map<string, number>();
    const concreteRecipes = (recipes || []).filter((r) => {
      if (r.is_active === false) return false;
      const itemType = String(r.item_type || '');
      return itemType !== 'aggregate' && itemType !== 'cement' && itemType !== 'fbs';
    });
    for (const r of concreteRecipes) {
      const cell = recipeToMatrixCell(r);
      if (!cell) continue;
      const matrixKey = `${cell.grade_key}|${cell.filler}`;
      if (!prices.has(matrixKey)) prices.set(matrixKey, cell.price);
      const ownKey = `${OWN_PLANT_ID}|${cell.grade_key}|${cell.filler}`;
      if (!prices.has(ownKey)) prices.set(ownKey, cell.price);
    }

    const latestSnap = new Map<string, number>();
    for (const s of snaps || []) {
      const key = `${s.competitor_id}|${s.grade_key}|${s.filler}`;
      if (latestSnap.has(key)) continue;
      const price = Number(s.price);
      if (Number.isFinite(price) && price > 0) {
        latestSnap.set(key, price);
        prices.set(key, price);
      }
    }

    const roadCurvature =
      Number(deliveryRow?.road_curvature_coefficient) > 0
        ? Number(deliveryRow!.road_curvature_coefficient)
        : DEFAULT_DELIVERY_SETTINGS.road_curvature_coefficient;

    // Уникальные адреса → геокод (как у заявок: сначала normalize)
    const addrKey = (raw: string) => normalizeDeliveryAddress(raw);
    const uniqueKeys = Array.from(new Set(orders.map((o) => addrKey(String(o.address).trim()))));
    const addressCoords = new Map<string, Coords | null>();

    await mapPool(uniqueKeys, 3, async (normalized) => {
      const fromText = extractCoordsFromAddress(normalized);
      if (fromText) {
        addressCoords.set(normalized, fromText);
        return;
      }
      try {
        const coords = await geocodeAddressWithFallback(normalized);
        addressCoords.set(normalized, coords);
      } catch {
        addressCoords.set(normalized, null);
      }
    });

    // В build — исходные адреса; координаты по нормализованному ключу
    const coordsByRaw = new Map<string, Coords | null>();
    for (const o of orders) {
      const raw = String(o.address || '').trim();
      coordsByRaw.set(raw, addressCoords.get(addrKey(raw)) ?? null);
    }

    const result = buildDeliveryAnalytics({
      from,
      to,
      orders,
      plants,
      prices,
      addressCoords: coordsByRaw,
      roadCurvature,
      maxExamples: 50,
    });

    return NextResponse.json(result);
  } catch (e: any) {
    console.error('delivery-analytics error:', e);
    return NextResponse.json({ error: e?.message || 'Ошибка расчёта' }, { status: 500 });
  }
}
