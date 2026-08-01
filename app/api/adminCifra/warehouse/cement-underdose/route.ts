import { NextRequest, NextResponse } from 'next/server';
import { requireAdminCifraStaff } from '@/lib/adminCifraAuth';
import {
  clientLabel,
  computeCementUnderdose,
  type UnderdoseOrderInput,
} from '@/lib/cementUnderdose';
import { siloNameById } from '@/lib/siloConfig';
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

async function loadRefills(siloId: number): Promise<RefillRow[]> {
  const siloName = siloNameById(siloId);
  const { data, error } = await supabase
    .from('warehouse_operations')
    .select('id, operation_type, item_type, amount, old_value, new_value, user_name, created_at')
    .eq('operation_type', 'add')
    .eq('item_type', siloName)
    .order('created_at', { ascending: false })
    .limit(30);

  if (error) throw error;

  return (data || []).map((op) => ({
    id: Number(op.id),
    createdAt: String(op.created_at),
    amountKg: Math.round(Number(op.amount || 0) * 10) / 10,
    userName: op.user_name != null ? String(op.user_name) : null,
    oldValue: op.old_value != null ? Number(op.old_value) : null,
    newValue: op.new_value != null ? Number(op.new_value) : null,
  }));
}

async function loadAnalysis(opts: {
  siloId: number;
  since: string;
  until: string;
  actualKg: number;
}) {
  const { siloId, since, until, actualKg } = opts;

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

  let trips: Array<{
    id: number;
    order_id: number;
    volume: number | null;
    cement_write_off_kg: number | null;
    cement_write_off_at: string;
  }> = [];
  let from = 0;
  const page = 1000;
  while (true) {
    const { data, error } = await supabase
      .from('order_mixers')
      .select('id, order_id, volume, cement_write_off_kg, cement_write_off_at')
      .eq('cement_write_off_silo_id', siloId)
      .gt('cement_write_off_at', since)
      .lte('cement_write_off_at', until)
      .order('cement_write_off_at', { ascending: true })
      .range(from, from + page - 1);
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

  const orderIds = [...byOrder.keys()];
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

    const refills = await loadRefills(siloId);

    // Только список загрузок
    if (!since || !until || actualKgRaw == null) {
      return NextResponse.json({
        siloId,
        siloName: siloNameById(siloId),
        refills,
      });
    }

    const actualKg = Number(actualKgRaw);
    const analysis = await loadAnalysis({ siloId, since, until, actualKg });
    if ('error' in analysis) {
      return NextResponse.json(
        { error: analysis.error, refills },
        { status: analysis.status },
      );
    }

    return NextResponse.json({
      refills,
      ...analysis.body,
    });
  } catch (err) {
    console.error('cement-underdose:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Ошибка расчёта' },
      { status: 500 },
    );
  }
}
