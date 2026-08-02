import { NextRequest, NextResponse } from 'next/server';
import { requireAdminCifraStaff } from '@/lib/adminCifraAuth';
import {
  buildRefillContext,
  buildRiskOrders,
  buildSiloTimeline,
  classifyWarehouseOps,
  clientLabel,
  computeCementUnderdose,
  filterRealRefills,
  pickSelectedRefill,
  previousRealRefill,
  type UnderdoseOrderInput,
  type WarehouseOpRaw,
} from '@/lib/cementUnderdose';
import { expectedSiloSavingTons, siloNameById } from '@/lib/siloConfig';
import { supabaseAdmin as supabase } from '@/lib/supabaseAdmin';

type RefillRow = {
  id: number;
  createdAt: string;
  amountKg: number;
  userName: string | null;
  oldValue: number | null;
  newValue: number | null;
};

function parseSiloId(raw: string | null): number | null {
  const id = Number(raw);
  return [1, 2, 3].includes(id) ? id : null;
}

function mapOp(row: {
  id: number | string;
  operation_type?: string | null;
  amount?: number | null;
  old_value?: number | null;
  new_value?: number | null;
  user_name?: string | null;
  created_at?: string | null;
}): WarehouseOpRaw {
  return {
    id: Number(row.id),
    operationType: String(row.operation_type || ''),
    amountKg: Math.round(Number(row.amount || 0) * 10) / 10,
    oldKg: row.old_value != null ? Number(row.old_value) : null,
    newKg: row.new_value != null ? Number(row.new_value) : null,
    userName: row.user_name != null ? String(row.user_name) : null,
    createdAt: String(row.created_at || ''),
  };
}

async function loadSiloOps(siloId: number, sinceIso: string, untilIso: string): Promise<WarehouseOpRaw[]> {
  const siloName = siloNameById(siloId);
  const { data, error } = await supabase
    .from('warehouse_operations')
    .select('id, operation_type, item_type, amount, old_value, new_value, user_name, created_at')
    .eq('item_type', siloName)
    .gte('created_at', sinceIso)
    .lte('created_at', untilIso)
    .order('created_at', { ascending: true })
    .limit(2000);
  if (error) throw error;
  return (data || []).map(mapOp);
}

async function loadRecentAddsAndManuals(siloId: number): Promise<WarehouseOpRaw[]> {
  const siloName = siloNameById(siloId);
  // Берём add + subtract + reset за 60 дней — для фильтра пар-отмен и списка загрузок
  const since = new Date(Date.now() - 60 * 86400000).toISOString();
  const { data, error } = await supabase
    .from('warehouse_operations')
    .select('id, operation_type, item_type, amount, old_value, new_value, user_name, created_at')
    .eq('item_type', siloName)
    .in('operation_type', ['add', 'subtract', 'reset'])
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) throw error;
  return (data || []).map(mapOp);
}

function classifiedToRefillRows(
  classified: ReturnType<typeof classifyWarehouseOps>,
): RefillRow[] {
  return filterRealRefills(classified).map((op) => ({
    id: op.id,
    createdAt: op.createdAt,
    amountKg: op.amountKg,
    userName: op.userName,
    oldValue: op.oldKg,
    newValue: op.newKg,
  }));
}

async function loadSavingsNear(
  siloId: number,
  aroundIso: string,
): Promise<Array<{ balanceBeforeTons: number; createdAt: string; amountKg: number }>> {
  const aroundMs = Date.parse(aroundIso);
  if (!Number.isFinite(aroundMs)) return [];
  const from = new Date(aroundMs - 10 * 60 * 1000).toISOString();
  const to = new Date(aroundMs + 2 * 60 * 1000).toISOString();
  try {
    const { data, error } = await supabase
      .from('warehouse_cement_savings')
      .select('amount_kg, balance_before_tons, created_at')
      .eq('silo_id', siloId)
      .gte('created_at', from)
      .lte('created_at', to)
      .order('created_at', { ascending: false })
      .limit(10);
    if (error) {
      if (String(error.message || '').includes('warehouse_cement_savings')) return [];
      throw error;
    }
    return (data || []).map((r) => ({
      amountKg: Math.round(Number(r.amount_kg || 0) * 10) / 10,
      balanceBeforeTons: Number(r.balance_before_tons || 0),
      createdAt: String(r.created_at),
    }));
  } catch {
    return [];
  }
}

async function loadTripsInWindow(
  siloId: number,
  since: string,
  until: string,
  opts?: { inclusiveSince?: boolean },
): Promise<
  Array<{
    id: number;
    order_id: number;
    volume: number | null;
    cement_write_off_kg: number | null;
    cement_write_off_at: string;
  }>
> {
  let trips: Array<{
    id: number;
    order_id: number;
    volume: number | null;
    cement_write_off_kg: number | null;
    cement_write_off_at: string;
  }> = [];
  let from = 0;
  const page = 1000;
  const inclusiveSince = Boolean(opts?.inclusiveSince);
  while (true) {
    let q = supabase
      .from('order_mixers')
      .select('id, order_id, volume, cement_write_off_kg, cement_write_off_at')
      .eq('cement_write_off_silo_id', siloId)
      .lte('cement_write_off_at', until)
      .order('cement_write_off_at', { ascending: true })
      .range(from, from + page - 1);
    q = inclusiveSince
      ? q.gte('cement_write_off_at', since)
      : q.gt('cement_write_off_at', since);
    const { data, error } = await q;
    if (error) throw error;
    trips = trips.concat(
      (data || []).map((t) => ({
        id: Number(t.id),
        order_id: Number(t.order_id),
        volume: t.volume != null ? Number(t.volume) : null,
        cement_write_off_kg:
          t.cement_write_off_kg != null ? Number(t.cement_write_off_kg) : null,
        cement_write_off_at: String(t.cement_write_off_at),
      })),
    );
    if (!data || data.length < page) break;
    from += page;
  }
  return trips;
}

async function loadOrdersMeta(orderIds: number[]) {
  const ordersById = new Map<
    number,
    {
      id: number;
      grade: string | null;
      organization_name: string | null;
      full_name: string | null;
      client_name: string | null;
    }
  >();
  for (let i = 0; i < orderIds.length; i += 200) {
    const chunk = orderIds.slice(i, i + 200);
    if (!chunk.length) continue;
    const { data, error } = await supabase
      .from('orders')
      .select('id, grade, organization_name, full_name, client_name')
      .in('id', chunk);
    if (error) throw error;
    for (const o of data || []) {
      ordersById.set(Number(o.id), {
        id: Number(o.id),
        grade: o.grade != null ? String(o.grade) : null,
        organization_name:
          o.organization_name != null ? String(o.organization_name) : null,
        full_name: o.full_name != null ? String(o.full_name) : null,
        client_name: o.client_name != null ? String(o.client_name) : null,
      });
    }
  }
  return ordersById;
}

function aggregateTripsByOrder(
  trips: Array<{
    order_id: number;
    volume: number | null;
    cement_write_off_kg: number | null;
  }>,
) {
  const byOrder = new Map<
    number,
    { volumeM3: number; recipeCementKg: number; trips: number }
  >();
  for (const t of trips) {
    const oid = Number(t.order_id);
    if (!oid) continue;
    if (!byOrder.has(oid)) {
      byOrder.set(oid, { volumeM3: 0, recipeCementKg: 0, trips: 0 });
    }
    const a = byOrder.get(oid)!;
    a.volumeM3 += Number(t.volume || 0);
    a.recipeCementKg += Number(t.cement_write_off_kg || 0);
    a.trips += 1;
  }
  return byOrder;
}

async function loadAnalysis(opts: {
  siloId: number;
  since: string;
  until: string;
  actualKg: number;
  refillId?: number | null;
}) {
  const { siloId, since, until, actualKg, refillId } = opts;

  const sinceMs = Date.parse(since);
  const untilMs = Date.parse(until);
  if (!Number.isFinite(sinceMs) || !Number.isFinite(untilMs)) {
    return { error: 'Некорректный период (since/until)', status: 400 as const };
  }
  if (untilMs < sinceMs) {
    return { error: '«По» раньше «С»', status: 400 as const };
  }
  if (!(actualKg >= 0) || !Number.isFinite(actualKg)) {
    return { error: 'Укажи фактический цемент (кг) ≥ 0', status: 400 as const };
  }

  const recentOps = await loadRecentAddsAndManuals(siloId);
  const classifiedAll = classifyWarehouseOps(recentOps);
  const realRefills = filterRealRefills(classifiedAll);
  const refills = classifiedToRefillRows(classifiedAll);
  const selected = pickSelectedRefill(realRefills, since, refillId ?? null);

  const expectedSavingKg = expectedSiloSavingTons(siloId) * 1000;
  const savingsNear = selected
    ? await loadSavingsNear(siloId, selected.createdAt)
    : [];

  // Окно таймлайна: от предыдущего реального пополнения (или −7 суток) до until
  const prev = selected ? previousRealRefill(realRefills, selected) : null;
  const timelineFromMs = prev
    ? Date.parse(prev.createdAt)
    : sinceMs - 7 * 86400000;
  const timelineToMs = Math.max(untilMs, selected ? Date.parse(selected.createdAt) + 3600000 : untilMs);

  const opsWindow = await loadSiloOps(
    siloId,
    new Date(timelineFromMs - 60_000).toISOString(),
    new Date(timelineToMs).toISOString(),
  );
  // Подмешиваем recent для классификации пар (могут быть на границе)
  const byId = new Map<number, WarehouseOpRaw>();
  for (const op of [...recentOps, ...opsWindow]) byId.set(op.id, op);
  const classified = classifyWarehouseOps([...byId.values()]);

  const refillContext = buildRefillContext({
    selected,
    classified,
    expectedSavingKg,
    savingsNear,
  });

  const timeline = buildSiloTimeline({
    classified,
    selectedRefillId: selected?.id ?? null,
    fromMs: timelineFromMs,
    toMs: timelineToMs,
  });

  // Риск-заявки: от аномалии (lookback 14 сут) / выбранной загрузки — до конца периода (until)
  let riskOrders: ReturnType<typeof buildRiskOrders>['rows'] = [];
  let riskSummary: ReturnType<typeof buildRiskOrders>['summary'] = {
    recipeKg: 0,
    volumeM3: 0,
    orderCount: 0,
    tripCount: 0,
    firstNegativeAt: null,
    firstNegativeOrderId: null,
  };

  if (selected) {
    const lookbackMs = Date.parse(selected.createdAt) - 14 * 86400000;
    const riskFromIso = new Date(lookbackMs).toISOString();
    const riskTrips = await loadTripsInWindow(siloId, riskFromIso, until, {
      inclusiveSince: true,
    });
    const tripAgg = aggregateTripsByOrder(riskTrips);
    const riskOrderIds = [...tripAgg.keys()];
    for (const op of classified) {
      if (op.isAutoWriteoff && op.orderId) riskOrderIds.push(op.orderId);
    }
    const ordersById = await loadOrdersMeta([...new Set(riskOrderIds)]);
    const orderMeta = new Map<number, { client: string; grade: string }>();
    for (const [oid, o] of ordersById) {
      orderMeta.set(oid, { client: clientLabel(o), grade: o.grade || '—' });
    }

    const riskBuilt = buildRiskOrders({
      classified,
      selectedRefillAt: selected.createdAt,
      afterMs: lookbackMs,
      untilMs,
      orderMeta,
      tripAgg,
    });
    riskOrders = riskBuilt.rows;
    riskSummary = riskBuilt.summary;
  }

  const trips = await loadTripsInWindow(siloId, since, until);
  const byOrder = aggregateTripsByOrder(trips);
  const orderIds = [...byOrder.keys()];
  const ordersById = await loadOrdersMeta(orderIds);

  const { data: recipes, error: recipesErr } = await supabase
    .from('recipes')
    .select('code, cement')
    .gt('cement', 0);
  if (recipesErr) throw recipesErr;

  const orderInputs: UnderdoseOrderInput[] = orderIds.map((oid) => {
    const agg = byOrder.get(oid)!;
    const o = ordersById.get(oid);
    return {
      orderId: oid,
      client: o ? clientLabel(o) : '—',
      grade: o?.grade || '—',
      volumeM3: agg.volumeM3,
      recipeCementKg: agg.recipeCementKg,
      trips: agg.trips,
    };
  });

  const result = computeCementUnderdose(
    orderInputs,
    actualKg,
    (recipes || []).map((r) => ({
      code: String(r.code),
      cement: Number(r.cement || 0),
    })),
  );

  return {
    status: 200 as const,
    body: {
      siloId,
      siloName: siloNameById(siloId),
      since,
      until,
      expectedSavingTons: expectedSiloSavingTons(siloId),
      refillContext,
      timeline,
      riskOrders,
      riskSummary,
      refills,
      ...result,
    },
  };
}

export async function GET(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request);
  if (auth.error) return auth.error;

  try {
    const { searchParams } = new URL(request.url);
    const siloId = parseSiloId(searchParams.get('siloId'));
    if (siloId == null) {
      return NextResponse.json({ error: 'Укажи силос 1–3' }, { status: 400 });
    }

    const since = searchParams.get('since');
    const until = searchParams.get('until');
    const actualKgRaw = searchParams.get('actualKg');
    const refillIdRaw = searchParams.get('refillId');
    const refillId =
      refillIdRaw != null && refillIdRaw !== ''
        ? Number(refillIdRaw)
        : null;

    const recentOps = await loadRecentAddsAndManuals(siloId);
    const classified = classifyWarehouseOps(recentOps);
    const refills = classifiedToRefillRows(classified);

    // Только список загрузок
    if (!since || !until || actualKgRaw == null) {
      return NextResponse.json({
        siloId,
        siloName: siloNameById(siloId),
        expectedSavingTons: expectedSiloSavingTons(siloId),
        refills,
      });
    }

    const actualKg = Number(actualKgRaw);
    const analysis = await loadAnalysis({
      siloId,
      since,
      until,
      actualKg,
      refillId: Number.isFinite(refillId as number) ? refillId : null,
    });
    if ('error' in analysis) {
      return NextResponse.json(
        { error: analysis.error, refills },
        { status: analysis.status },
      );
    }

    return NextResponse.json({
      ...analysis.body,
      // refills уже в body; на случай если нет — подстрахуем
      refills: analysis.body.refills?.length ? analysis.body.refills : refills,
    });
  } catch (err) {
    console.error('cement-underdose:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Ошибка расчёта' },
      { status: 500 },
    );
  }
}
