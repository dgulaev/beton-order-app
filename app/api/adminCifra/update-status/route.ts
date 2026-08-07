// app/api/adminCifra/update-status/route.ts
import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { ADMIN_MUTATION_ROLES, requireAdminCifraStaff } from '@/lib/adminCifraAuth';
import {
  ORDER_STATUS_RU,
  applyOrderStatusSideEffects,
  assertManualCompleteAllowed,
  isFinalOrderStatus,
  isOrderStatus,
} from '@/lib/orderStatusTransition';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabase = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY!);

export async function POST(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request, ADMIN_MUTATION_ROLES);
  if (auth.error) return auth.error;

  try {
    const { orderId, status } = await request.json();

    if (!orderId || !status) {
      return NextResponse.json({ error: 'orderId и status обязательны' }, { status: 400 });
    }

    if (!isOrderStatus(status)) {
      return NextResponse.json({ error: 'Недопустимый статус заявки' }, { status: 400 });
    }

    const numericId = Number(orderId);
    if (!Number.isFinite(numericId)) {
      return NextResponse.json({ error: 'Некорректный orderId' }, { status: 400 });
    }

    const isAdmin = auth.user.role === 'admin';

    const { data: before } = await supabase
      .from('orders')
      .select('id, status, delivery_date, referred_by, volume')
      .eq('id', numericId)
      .maybeSingle();

    if (!before) {
      return NextResponse.json({ error: 'Заявка не найдена' }, { status: 404 });
    }

    if (isFinalOrderStatus(before.status) && !isAdmin) {
      return NextResponse.json(
        {
          error: `Заявка уже в финальном статусе "${ORDER_STATUS_RU[before.status] || before.status}" — менять может только админ`,
        },
        { status: 400 },
      );
    }

    if (String(before.status) === status) {
      return NextResponse.json({ success: true });
    }

    if (status === 'completed' && before.status !== 'completed') {
      const check = await assertManualCompleteAllowed(
        supabase,
        numericId,
        Number(before.volume || 0),
      );
      if (!check.ok) {
        return NextResponse.json({ error: check.message }, { status: 400 });
      }
    }

    const { error } = await supabase
      .from('orders')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', numericId);

    if (error) {
      console.error('Supabase update error:', error);
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    await applyOrderStatusSideEffects({
      supabase,
      orderId: numericId,
      oldStatus: String(before.status),
      newStatus: status,
      deliveryDate: before.delivery_date,
      referredBy: before.referred_by,
      volume: before.volume,
      actorName: auth.user.full_name || 'Система',
    });

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('Update status error:', e);
    return NextResponse.json({ error: 'Внутренняя ошибка сервера' }, { status: 500 });
  }
}
