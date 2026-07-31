/**
 * Обзор цемента для KPI на «Заявках»:
 * силосы на начало дня, live-остаток/расход, заявки с нехваткой, сколько привезти на 7 дней.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdminCifraStaff } from '@/lib/adminCifraAuth';
import { getMekaCementCompensation } from '@/lib/mekaCementCompensate';
import {
  calculateCementUsageKg,
  findRecipeByGrade,
  type RecipeLike,
} from '@/lib/recipeAdditives';
import { SILO_SPEC, siloIdFromItemType, siloNameById } from '@/lib/siloConfig';
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

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function kgToTons(kg: number): number {
  return round2(kg / 1000);
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

export async function GET(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request);
  if (auth.error) return auth.error;

  try {
    const dateIso = request.nextUrl.searchParams.get('date');
    if (!dateIso || !/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) {
      return NextResponse.json({ error: 'Нужен date=YYYY-MM-DD' }, { status: 400 });
    }

    const today = todayMoscowYmd();
    const isToday = dateIso === today;
    const isFuture = dateIso > today;
    const { start, end } = moscowDayBounds(dateIso);

    const forecastDates: string[] = [];
    for (let i = 0; i < 7; i++) forecastDates.push(addDaysYmd(dateIso, i));
    const forecastSet = new Set(forecastDates);
    const weekEnd = addDaysYmd(dateIso, 6);

    const [silosRes, opsRes, writeoffsRes, recipesRes, ordersRes] = await Promise.all([
      supabase.from('warehouse_silos').select('silo_id, name, current, max').order('silo_id'),
      supabase
        .from('warehouse_operations')
        .select('item_type, operation_type, amount, old_value, new_value, created_at')
        .gte('created_at', start)
        .lt('created_at', end)
        .order('created_at', { ascending: true }),
      supabase
        .from('order_mixers')
        .select('id, cement_write_off_silo_id, cement_write_off_kg, cement_write_off_at')
        .not('cement_write_off_kg', 'is', null)
        .gte('cement_write_off_at', start)
        .lt('cement_write_off_at', end),
      supabase
        .from('recipes')
        .select('code, name, type, cement, additive, additive2, item_type'),
      supabase
        .from('orders')
        .select(
          'id, grade, volume, status, delivery_date, delivery_time, organization_name, full_name, client_name',
        )
        .gte('delivery_date', dateIso)
        .lte('delivery_date', weekEnd)
        .neq('status', 'cancelled'),
    ]);

    if (silosRes.error) throw silosRes.error;
    if (opsRes.error) throw opsRes.error;
    if (writeoffsRes.error) throw writeoffsRes.error;
    if (recipesRes.error) throw recipesRes.error;
    if (ordersRes.error) throw ordersRes.error;

    const recipes = (recipesRes.data || []) as RecipeLike[];
    const siloRows = silosRes.data || [];
    const liveById = new Map(
      siloRows.map((s) => [Number(s.silo_id), Number(s.current || 0)]),
    );

    const weekOrderIds = (ordersRes.data || [])
      .map((o) => Number(o.id))
      .filter((id) => Number.isFinite(id) && id > 0);

    let mixerRows: { order_id: number; volume: number; status: string }[] = [];
    if (weekOrderIds.length > 0) {
      // чанками — PostgREST лимит IN
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

    // Списания рейсов по силосам (кг)
    const consumedKgBySilo = new Map<number, number>();
    for (const spec of SILO_SPEC) consumedKgBySilo.set(spec.silo_id, 0);
    let tripsKg = 0;
    for (const row of writeoffsRes.data || []) {
      const kg = Number(row.cement_write_off_kg || 0);
      if (!(kg > 0)) continue;
      tripsKg += kg;
      const siloId = Number(row.cement_write_off_silo_id);
      if (consumedKgBySilo.has(siloId)) {
        consumedKgBySilo.set(siloId, (consumedKgBySilo.get(siloId) || 0) + kg);
      }
    }

    // Компенсация MEKA — как в cement-day
    const compensation = await getMekaCementCompensation(dateIso);
    let compensationAdjKg = 0;
    if (compensation?.status === 'applied') {
      for (const row of compensation.bySilo) {
        const signed = row.direction === 'writeoff' ? row.kg : -row.kg;
        compensationAdjKg += signed;
        if (consumedKgBySilo.has(row.siloId)) {
          consumedKgBySilo.set(
            row.siloId,
            (consumedKgBySilo.get(row.siloId) || 0) + signed,
          );
        }
      }
    }
    const consumedLiveKg = round1(tripsKg + compensationAdjKg);

    // Операции дня: начало (old первой) и конец (new последней), внесения
    type OpAgg = {
      firstOldKg: number | null;
      lastNewKg: number | null;
      refillKg: number;
    };
    const opBySilo = new Map<number, OpAgg>();
    for (const spec of SILO_SPEC) {
      opBySilo.set(spec.silo_id, { firstOldKg: null, lastNewKg: null, refillKg: 0 });
    }
    for (const op of opsRes.data || []) {
      const siloId = siloIdFromItemType(op.item_type);
      if (!siloId || !opBySilo.has(siloId)) continue;
      const agg = opBySilo.get(siloId)!;
      const oldKg = Number(op.old_value);
      const newKg = Number(op.new_value);
      if (agg.firstOldKg == null && Number.isFinite(oldKg)) agg.firstOldKg = oldKg;
      if (Number.isFinite(newKg)) agg.lastNewKg = newKg;
      if (String(op.operation_type) === 'add' && Number.isFinite(newKg) && Number.isFinite(oldKg)) {
        const delta = newKg - oldKg;
        if (delta > 0) agg.refillKg += delta;
      }
    }

    const silos = SILO_SPEC.map((spec) => {
      const live = liveById.get(spec.silo_id) ?? 0;
      const agg = opBySilo.get(spec.silo_id)!;
      const consumedTons = kgToTons(consumedKgBySilo.get(spec.silo_id) || 0);
      const refillTons = kgToTons(agg.refillKg);

      let startTons: number;
      if (agg.firstOldKg != null) {
        startTons = kgToTons(agg.firstOldKg);
      } else if (isFuture) {
        startTons = round2(live);
      } else if (isToday) {
        // Не было движений — на начало дня = сейчас; иначе восстановим от live + расход − внесения
        startTons = round2(live + consumedTons - refillTons);
      } else {
        startTons = round2(live + consumedTons - refillTons);
      }

      let currentTons: number;
      if (isToday || isFuture) {
        currentTons = round2(live);
      } else if (agg.lastNewKg != null) {
        currentTons = kgToTons(agg.lastNewKg);
      } else {
        currentTons = round2(startTons - consumedTons + refillTons);
      }

      return {
        siloId: spec.silo_id,
        name: siloNameById(spec.silo_id),
        maxTons: spec.max,
        startTons: round2(startTons),
        currentTons: round2(currentTons),
        consumedTons: round2(Math.max(0, consumedTons)),
        refillTons: round2(refillTons),
      };
    });

    const totals = {
      startTons: round2(silos.reduce((s, x) => s + x.startTons, 0)),
      currentTons: round2(silos.reduce((s, x) => s + x.currentTons, 0)),
      consumedTons: round2(kgToTons(consumedLiveKg)),
      maxTons: SILO_SPEC.reduce((s, x) => s + x.max, 0),
      refillTons: round2(silos.reduce((s, x) => s + x.refillTons, 0)),
    };

    // Разгрузка по заявкам (статус Разгружен)
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

    // План/факт дня выбранной даты (как на карточке)
    let dayPlanKg = 0;
    let dayUnloadedKg = 0;
    for (const o of weekOrders) {
      if (o.delivery_date !== dateIso) continue;
      const recipe = findRecipeByGrade(recipes, o.grade);
      const planVol = o.volume;
      const unloaded =
        o.status === 'completed'
          ? planVol
          : Math.min(planVol, unloadedByOrder.get(o.id) || 0);
      dayPlanKg += calculateCementUsageKg(recipe, planVol);
      dayUnloadedKg += calculateCementUsageKg(recipe, unloaded);
    }

    // Остаток по заявкам недели, который ещё надо закрыть цементом
    type NeedRow = {
      id: number;
      grade: string;
      client: string | null;
      deliveryDate: string;
      deliveryTime: string | null;
      volumeM3: number;
      remainingM3: number;
      cementTons: number;
    };

    const needRows: NeedRow[] = [];
    for (const o of weekOrders) {
      const recipe = findRecipeByGrade(recipes, o.grade);
      const unloaded =
        o.status === 'completed'
          ? o.volume
          : Math.min(o.volume, unloadedByOrder.get(o.id) || 0);
      const remainingM3 = Math.max(0, round2(o.volume - unloaded));
      if (remainingM3 <= 0) continue;
      const cementKg = calculateCementUsageKg(recipe, remainingM3);
      if (!(cementKg > 0)) continue;
      needRows.push({
        id: o.id,
        grade: o.grade || '—',
        client: o.client,
        deliveryDate: o.delivery_date,
        deliveryTime: o.delivery_time,
        volumeM3: round2(o.volume),
        remainingM3,
        cementTons: kgToTons(cementKg),
      });
    }

    needRows.sort((a, b) => {
      const d = a.deliveryDate.localeCompare(b.deliveryDate);
      if (d !== 0) return d;
      return String(a.deliveryTime || '').localeCompare(String(b.deliveryTime || ''));
    });

    const weekNeededTons = round2(needRows.reduce((s, r) => s + r.cementTons, 0));
    const stockTons = totals.currentTons;
    const bringTons = round1(Math.max(0, weekNeededTons - stockTons));

    // Симуляция: куда не хватит при текущем остатке
    let pool = stockTons;
    const shortfallOrders: Array<
      NeedRow & { stockBeforeTons: number; deficitTons: number }
    > = [];
    for (const row of needRows) {
      const before = round2(pool);
      if (before + 1e-9 < row.cementTons) {
        shortfallOrders.push({
          ...row,
          stockBeforeTons: before,
          deficitTons: round2(row.cementTons - Math.max(0, before)),
        });
      }
      pool = round2(pool - row.cementTons);
    }

    return NextResponse.json({
      date: dateIso,
      asOf: new Date().toISOString(),
      isToday,
      isFuture,
      silos,
      totals,
      day: {
        planTons: kgToTons(dayPlanKg),
        unloadedTons: kgToTons(dayUnloadedKg),
      },
      week: {
        dateFrom: dateIso,
        dateTo: weekEnd,
        neededTons: weekNeededTons,
        stockTons: round2(stockTons),
        bringTons,
        shortage: bringTons > 0,
        orderCount: needRows.length,
        remainingVolumeM3: round2(needRows.reduce((s, r) => s + r.remainingM3, 0)),
      },
      shortfallOrders,
    });
  } catch (err: any) {
    console.error('cement-overview GET:', err);
    return NextResponse.json(
      { error: err?.message || 'Ошибка загрузки обзора цемента' },
      { status: 500 },
    );
  }
}
