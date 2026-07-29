import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  ADMIN_CIFRA_STAFF_ROLES,
  ORDER_MUTATION_ROLES,
  requireAdminCifraStaff,
} from '@/lib/adminCifraAuth';
import { BULK_VEHICLE_KINDS } from '@/lib/orderLogistics';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const UNITS = new Set(['m3', 't', 'kg']);
const BULK_KIND_SET = new Set<string>(BULK_VEHICLE_KINDS);

/** Синхронизация статуса bulk-заявки с суммой отгрузок. */
async function syncBulkOrderStatus(
  orderId: number,
  orderVolume: number,
  currentStatus: string | null | undefined,
): Promise<{ shippedTotal: number; orderStatus: string }> {
  const { data: rows } = await supabase
    .from('bulk_shipments')
    .select('volume')
    .eq('order_id', orderId);
  const shippedTotal = (rows || []).reduce((s, r) => s + Number(r.volume || 0), 0);
  const orderVol = Number(orderVolume || 0);
  let orderStatus = String(currentStatus || 'new');

  if (orderVol > 0 && shippedTotal >= orderVol - 0.001) {
    if (orderStatus !== 'completed' && orderStatus !== 'cancelled') {
      await supabase.from('orders').update({ status: 'completed' }).eq('id', orderId);
      orderStatus = 'completed';
    }
  } else if (orderStatus === 'completed') {
    // Ошибочную отгрузку убрали — возвращаем в работу
    await supabase.from('orders').update({ status: 'processing' }).eq('id', orderId);
    orderStatus = 'processing';
  }

  return { shippedTotal, orderStatus };
}

export async function GET(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request, ADMIN_CIFRA_STAFF_ROLES);
  if (auth.error) return auth.error;

  try {
    const orderId = request.nextUrl.searchParams.get('order_id');
    if (!orderId) {
      return NextResponse.json({ error: 'order_id обязателен' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('bulk_shipments')
      .select('*')
      .eq('order_id', Number(orderId))
      .order('shipped_at', { ascending: false })
      .limit(200);

    if (error) {
      if (/bulk_shipments/i.test(error.message)) return NextResponse.json([]);
      throw error;
    }
    return NextResponse.json(data || []);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request, ORDER_MUTATION_ROLES);
  if (auth.error) return auth.error;

  try {
    const body = await request.json();
    const {
      order_id,
      volume,
      loading_point_id,
      vehicle_kind,
      vehicle_number,
      unit = 'm3',
      product_code,
      notes,
      shipped_at,
    } = body;

    const vol = Number(volume);
    if (!order_id || !Number.isFinite(vol) || vol <= 0) {
      return NextResponse.json({ error: 'order_id и volume обязательны' }, { status: 400 });
    }
    if (!UNITS.has(String(unit))) {
      return NextResponse.json({ error: 'unit: m3 | t | kg' }, { status: 400 });
    }
    if (vehicle_kind && !BULK_KIND_SET.has(String(vehicle_kind))) {
      return NextResponse.json({ error: 'Некорректный vehicle_kind' }, { status: 400 });
    }

    const { data: order, error: oErr } = await supabase
      .from('orders')
      .select('id, order_type, grade, volume, loading_point_id, fleet_vehicle_kind, status')
      .eq('id', order_id)
      .single();
    if (oErr || !order) {
      return NextResponse.json({ error: 'Заявка не найдена' }, { status: 404 });
    }
    if (String(order.order_type || 'concrete') !== 'bulk') {
      return NextResponse.json(
        { error: 'Отгрузки склада только для заявок типа «отгрузка» (bulk)' },
        { status: 400 },
      );
    }

    const { data: existingRows } = await supabase
      .from('bulk_shipments')
      .select('volume')
      .eq('order_id', order_id);
    const already = (existingRows || []).reduce((s, r) => s + Number(r.volume || 0), 0);
    const orderVol = Number(order.volume || 0);
    if (orderVol > 0 && already + vol > orderVol + 0.001) {
      return NextResponse.json(
        {
          error: `Превышение объёма заявки: уже ${already}, заявка ${orderVol}, пытаетесь добавить ${vol}`,
        },
        { status: 400 },
      );
    }

    const { data, error } = await supabase
      .from('bulk_shipments')
      .insert([
        {
          order_id: Number(order_id),
          volume: vol,
          unit,
          loading_point_id: loading_point_id ?? order.loading_point_id ?? null,
          vehicle_kind: vehicle_kind || order.fleet_vehicle_kind || null,
          vehicle_number: vehicle_number || null,
          product_code: product_code || order.grade || null,
          notes: notes || null,
          shipped_at: shipped_at || new Date().toISOString(),
          created_by: auth.user.user_id,
        },
      ])
      .select()
      .single();

    if (error) {
      if (/bulk_shipments/i.test(error.message)) {
        return NextResponse.json(
          { error: 'Выполните scripts/bulk-shipments.sql в Supabase' },
          { status: 503 }
        );
      }
      throw error;
    }

    const { shippedTotal, orderStatus } = await syncBulkOrderStatus(
      Number(order_id),
      orderVol,
      order.status,
    );

    return NextResponse.json({ success: true, data, shippedTotal, orderStatus });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request, ORDER_MUTATION_ROLES);
  if (auth.error) return auth.error;

  try {
    const id = Number(request.nextUrl.searchParams.get('id'));
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: 'id обязателен' }, { status: 400 });
    }

    const { data: row, error: findErr } = await supabase
      .from('bulk_shipments')
      .select('id, order_id, volume')
      .eq('id', id)
      .maybeSingle();

    if (findErr) {
      if (/bulk_shipments/i.test(findErr.message)) {
        return NextResponse.json(
          { error: 'Выполните scripts/bulk-shipments.sql в Supabase' },
          { status: 503 },
        );
      }
      throw findErr;
    }
    if (!row) {
      return NextResponse.json({ error: 'Отгрузка не найдена' }, { status: 404 });
    }

    const { data: order } = await supabase
      .from('orders')
      .select('id, order_type, volume, status')
      .eq('id', row.order_id)
      .maybeSingle();

    const { error: delErr } = await supabase.from('bulk_shipments').delete().eq('id', id);
    if (delErr) throw delErr;

    let shippedTotal = 0;
    let orderStatus = String(order?.status || 'processing');
    if (order && String(order.order_type || '') === 'bulk') {
      const synced = await syncBulkOrderStatus(
        Number(order.id),
        Number(order.volume || 0),
        order.status,
      );
      shippedTotal = synced.shippedTotal;
      orderStatus = synced.orderStatus;
    }

    return NextResponse.json({
      success: true,
      deletedId: id,
      orderId: row.order_id,
      shippedTotal,
      orderStatus,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
