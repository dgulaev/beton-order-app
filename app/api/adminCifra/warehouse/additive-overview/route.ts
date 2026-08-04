/**
 * Обзор добавки (ПФМ / Линомикс) для KPI на «Заявках»:
 * ёмкость на начало дня, live-остаток/расход, заявки с нехваткой, сколько привезти на 7 дней.
 * Структура ответа — как у cement-overview, единицы: литры (+ кг для дня).
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdminCifraStaff } from '@/lib/adminCifraAuth';
import {
  ADDITIVE_NAMES,
  calculateAdditiveUsage,
  densitiesFromLabSettings,
  findRecipeByGrade,
  getAdditiveDosage,
  type AdditiveDensities,
  type RecipeLike,
} from '@/lib/recipeAdditives';
import { todayMoscowYmd } from '@/lib/leads';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

function moscowDayBounds(dateKey: string): { start: string; end: string } {
  const start = new Date(`${dateKey}T00:00:00+03:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round0(n: number): number {
  return Math.round(n);
}

function orderDateKey(raw: unknown): string {
  if (!raw) return '';
  if (typeof raw === 'string') return raw.substring(0, 10);
  const d = new Date(raw as string);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  dt.setDate(dt.getDate() + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function additiveIdFromItemType(itemType: unknown): 1 | 2 | null {
  const s = String(itemType || '').toLowerCase();
  if (!s) return null;
  if (s.includes('линомикс') || s.includes('linomix')) return 2;
  if (s.includes('пфм') || s.includes('нлк') || s.includes('pfm')) return 1;
  return null;
}

export async function GET(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request);
  if (auth.error) return auth.error;

  try {
    const dateIso = request.nextUrl.searchParams.get('date');
    const additiveParam = Number(request.nextUrl.searchParams.get('additiveId'));
    if (!dateIso || !/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) {
      return NextResponse.json({ error: 'Нужен date=YYYY-MM-DD' }, { status: 400 });
    }
    if (additiveParam !== 1 && additiveParam !== 2) {
      return NextResponse.json({ error: 'Нужен additiveId=1|2' }, { status: 400 });
    }
    const additiveId = additiveParam as 1 | 2;

    const today = todayMoscowYmd();
    const isToday = dateIso === today;
    const isFuture = dateIso > today;
    const { start, end } = moscowDayBounds(dateIso);

    const forecastDates: string[] = [];
    for (let i = 0; i < 7; i++) forecastDates.push(addDaysYmd(dateIso, i));
    const forecastSet = new Set(forecastDates);
    const weekEnd = addDaysYmd(dateIso, 6);

    const [tankRes, opsRes, writeoffsRes, recipesRes, labRes, ordersRes] = await Promise.all([
      supabase
        .from('warehouse_additives')
        .select('additive_id, name, current, max')
        .eq('additive_id', additiveId)
        .maybeSingle(),
      supabase
        .from('warehouse_operations')
        .select('item_type, operation_type, amount, old_value, new_value, created_at')
        .gte('created_at', start)
        .lt('created_at', end)
        .order('created_at', { ascending: true }),
      supabase
        .from('order_mixers')
        .select(
          'id, additive_write_off_id, additive_write_off_liters, additive_write_off_kg, unloaded_at',
        )
        .eq('additive_write_off_id', additiveId)
        .not('additive_write_off_liters', 'is', null),
      supabase
        .from('recipes')
        .select('code, name, type, cement, additive, additive2, item_type'),
      supabase
        .from('lab_settings')
        .select('pfm_density_kg_per_l, linomix_density_kg_per_l')
        .eq('id', 1)
        .maybeSingle(),
      supabase
        .from('orders')
        .select(
          'id, grade, volume, status, delivery_date, delivery_time, organization_name, full_name, client_name',
        )
        .gte('delivery_date', dateIso)
        .lte('delivery_date', weekEnd)
        .neq('status', 'cancelled'),
    ]);

    if (tankRes.error) throw tankRes.error;
    if (opsRes.error) throw opsRes.error;
    if (writeoffsRes.error) throw writeoffsRes.error;
    if (recipesRes.error) throw recipesRes.error;
    if (ordersRes.error) throw ordersRes.error;

    const densities: AdditiveDensities = densitiesFromLabSettings(labRes.data);
    const recipes = (recipesRes.data || []) as RecipeLike[];
    const liveLiters = Number(tankRes.data?.current || 0);
    const maxLiters = Number(tankRes.data?.max || (additiveId === 1 ? 9000 : 1000));
    const name =
      String(tankRes.data?.name || '').trim() || ADDITIVE_NAMES[additiveId];

    // Списания рейсов за день (по unloaded_at / write_off_at)
    let consumedLiters = 0;
    let consumedKg = 0;
    for (const row of writeoffsRes.data || []) {
      const at = row.unloaded_at;
      if (!at) continue;
      const t = new Date(at).getTime();
      if (t < new Date(start).getTime() || t >= new Date(end).getTime()) continue;
      const liters = Number(row.additive_write_off_liters || 0);
      const kg = Number(row.additive_write_off_kg || 0);
      if (liters > 0) consumedLiters += liters;
      if (kg > 0) consumedKg += kg;
    }
    consumedLiters = round1(consumedLiters);
    consumedKg = round1(consumedKg);

    // Ручные операции дня по этой добавке
    let firstOld: number | null = null;
    let lastNew: number | null = null;
    let refillLiters = 0;
    for (const op of opsRes.data || []) {
      if (additiveIdFromItemType(op.item_type) !== additiveId) continue;
      const oldV = Number(op.old_value);
      const newV = Number(op.new_value);
      if (firstOld == null && Number.isFinite(oldV)) firstOld = oldV;
      if (Number.isFinite(newV)) lastNew = newV;
      if (String(op.operation_type) === 'add' && Number.isFinite(newV) && Number.isFinite(oldV)) {
        const delta = newV - oldV;
        if (delta > 0) refillLiters += delta;
      }
    }
    refillLiters = round1(refillLiters);

    let startLiters: number;
    if (firstOld != null) {
      startLiters = round1(firstOld);
    } else if (isFuture) {
      startLiters = round1(liveLiters);
    } else {
      startLiters = round1(liveLiters + consumedLiters - refillLiters);
    }

    let currentLiters: number;
    if (isToday || isFuture) {
      currentLiters = round1(liveLiters);
    } else if (lastNew != null) {
      currentLiters = round1(lastNew);
    } else {
      currentLiters = round1(startLiters - consumedLiters + refillLiters);
    }

    const tanks = [
      {
        additiveId,
        name,
        maxLiters: round0(maxLiters),
        startLiters: round1(Math.max(0, startLiters)),
        currentLiters: round1(Math.max(0, currentLiters)),
        consumedLiters: round1(Math.max(0, consumedLiters)),
        refillLiters: round1(Math.max(0, refillLiters)),
      },
    ];

    const totals = {
      startLiters: tanks[0].startLiters,
      currentLiters: tanks[0].currentLiters,
      consumedLiters: tanks[0].consumedLiters,
      consumedKg,
      maxLiters: tanks[0].maxLiters,
      refillLiters: tanks[0].refillLiters,
    };

    const weekOrderIds = (ordersRes.data || [])
      .map((o) => Number(o.id))
      .filter((id) => Number.isFinite(id) && id > 0);

    let mixerRows: { order_id: number; volume: number; status: string }[] = [];
    if (weekOrderIds.length > 0) {
      const chunk = 200;
      for (let i = 0; i < weekOrderIds.length; i += chunk) {
        const slice = weekOrderIds.slice(i, i + chunk);
        const { data, error } = await supabase
          .from('order_mixers')
          .select('order_id, volume, status')
          .in('order_id', slice);
        if (error) throw error;
        mixerRows = mixerRows.concat((data || []) as any[]);
      }
    }

    const unloadedByOrder = new Map<number, number>();
    for (const m of mixerRows) {
      if (String(m.status) !== 'Разгружен') continue;
      const oid = Number(m.order_id);
      if (!Number.isFinite(oid)) continue;
      unloadedByOrder.set(oid, (unloadedByOrder.get(oid) || 0) + Number(m.volume || 0));
    }

    type OrderRow = {
      id: number;
      grade: string;
      volume: number;
      status: string;
      delivery_date: string;
      delivery_time: string | null;
      client: string | null;
    };

    const weekOrders = ((ordersRes.data || []) as any[])
      .map(
        (o): OrderRow => ({
          id: Number(o.id),
          grade: String(o.grade || ''),
          volume: Number(o.volume || 0),
          status: String(o.status || ''),
          delivery_date: orderDateKey(o.delivery_date),
          delivery_time: o.delivery_time != null ? String(o.delivery_time) : null,
          client:
            String(o.organization_name || o.full_name || o.client_name || '').trim() ||
            null,
        }),
      )
      .filter((o) => forecastSet.has(o.delivery_date) && o.volume > 0);

    let dayPlanLiters = 0;
    let dayUnloadedLiters = 0;
    let dayPlanKg = 0;
    let dayUnloadedKg = 0;
    for (const o of weekOrders) {
      if (o.delivery_date !== dateIso) continue;
      const recipe = findRecipeByGrade(recipes, o.grade);
      const dosage = getAdditiveDosage(recipe, densities);
      if (!dosage || dosage.additiveId !== additiveId) continue;
      const planVol = o.volume;
      const unloaded =
        o.status === 'completed'
          ? planVol
          : Math.min(planVol, unloadedByOrder.get(o.id) || 0);
      const planUsage = calculateAdditiveUsage(recipe, planVol, densities);
      const unloadedUsage = calculateAdditiveUsage(recipe, unloaded, densities);
      if (planUsage) {
        dayPlanLiters += planUsage.liters;
        dayPlanKg += planUsage.kg;
      }
      if (unloadedUsage) {
        dayUnloadedLiters += unloadedUsage.liters;
        dayUnloadedKg += unloadedUsage.kg;
      }
    }

    type NeedRow = {
      id: number;
      grade: string;
      client: string | null;
      deliveryDate: string;
      deliveryTime: string | null;
      volumeM3: number;
      remainingM3: number;
      additiveLiters: number;
      additiveKg: number;
    };

    const needRows: NeedRow[] = [];
    for (const o of weekOrders) {
      const recipe = findRecipeByGrade(recipes, o.grade);
      const dosage = getAdditiveDosage(recipe, densities);
      if (!dosage || dosage.additiveId !== additiveId) continue;
      const unloaded =
        o.status === 'completed'
          ? o.volume
          : Math.min(o.volume, unloadedByOrder.get(o.id) || 0);
      const remainingM3 = Math.max(0, round1(o.volume - unloaded));
      if (remainingM3 <= 0) continue;
      const usage = calculateAdditiveUsage(recipe, remainingM3, densities);
      if (!usage || !(usage.liters > 0)) continue;
      needRows.push({
        id: o.id,
        grade: o.grade || '—',
        client: o.client,
        deliveryDate: o.delivery_date,
        deliveryTime: o.delivery_time,
        volumeM3: round1(o.volume),
        remainingM3,
        additiveLiters: round1(usage.liters),
        additiveKg: round1(usage.kg),
      });
    }

    needRows.sort((a, b) => {
      const d = a.deliveryDate.localeCompare(b.deliveryDate);
      if (d !== 0) return d;
      return String(a.deliveryTime || '').localeCompare(String(b.deliveryTime || ''));
    });

    const weekNeededLiters = round1(needRows.reduce((s, r) => s + r.additiveLiters, 0));
    const stockLiters = totals.currentLiters;
    const bringLiters = round0(Math.max(0, weekNeededLiters - stockLiters));

    let pool = stockLiters;
    const shortfallOrders: Array<
      NeedRow & { stockBeforeLiters: number; deficitLiters: number }
    > = [];
    for (const row of needRows) {
      const before = round1(pool);
      if (before + 1e-9 < row.additiveLiters) {
        shortfallOrders.push({
          ...row,
          stockBeforeLiters: before,
          deficitLiters: round1(row.additiveLiters - Math.max(0, before)),
        });
      }
      pool = round1(pool - row.additiveLiters);
    }

    return NextResponse.json({
      date: dateIso,
      asOf: new Date().toISOString(),
      isToday,
      isFuture,
      additiveId,
      name,
      tanks,
      totals,
      day: {
        planLiters: round1(dayPlanLiters),
        unloadedLiters: round1(dayUnloadedLiters),
        planKg: round1(dayPlanKg),
        unloadedKg: round1(dayUnloadedKg),
      },
      week: {
        dateFrom: dateIso,
        dateTo: weekEnd,
        neededLiters: weekNeededLiters,
        stockLiters: round1(stockLiters),
        bringLiters,
        shortage: bringLiters > 0,
        orderCount: needRows.length,
        remainingVolumeM3: round1(needRows.reduce((s, r) => s + r.remainingM3, 0)),
      },
      shortfallOrders,
    });
  } catch (err: any) {
    console.error('additive-overview GET:', err);
    return NextResponse.json(
      { error: err?.message || 'Ошибка загрузки обзора добавки' },
      { status: 500 },
    );
  }
}
