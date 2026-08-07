// app/api/admin/update-status/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { ADMIN_MUTATION_ROLES, requireAdminCifraStaff } from '@/lib/adminCifraAuth';
import {
  ORDER_STATUS_RU,
  applyOrderStatusSideEffects,
  assertManualCompleteAllowed,
  isFinalOrderStatus,
  isOrderStatus,
} from '@/lib/orderStatusTransition';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request, ADMIN_MUTATION_ROLES);
  if (auth.error) return auth.error;

  try {
    const body = await request.json();
    const { orderId, status } = body;

    const numericId = Number(orderId);
    if (!Number.isFinite(numericId) || !status) {
      return NextResponse.json(
        { success: false, message: 'orderId и status обязательны' },
        { status: 400 },
      );
    }

    if (!isOrderStatus(status)) {
      return NextResponse.json(
        { success: false, message: 'Недопустимый статус заявки' },
        { status: 400 },
      );
    }

    const isAdmin = auth.user.role === 'admin';

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('referred_by, volume, status, id, delivery_date')
      .eq('id', numericId)
      .single();

    if (orderError || !order) {
      return NextResponse.json({ success: false, message: 'Заказ не найден' }, { status: 404 });
    }

    if (isFinalOrderStatus(order.status) && !isAdmin) {
      return NextResponse.json(
        {
          success: false,
          message: `Статус "${ORDER_STATUS_RU[order.status] || order.status}" финальный — менять может только админ`,
        },
        { status: 400 },
      );
    }

    if (String(order.status) === status) {
      return NextResponse.json({ success: true, message: 'Статус не изменился' });
    }

    if (status === 'completed' && order.status !== 'completed') {
      const check = await assertManualCompleteAllowed(
        supabase,
        numericId,
        Number(order.volume || 0),
      );
      if (!check.ok) {
        return NextResponse.json({ success: false, message: check.message }, { status: 400 });
      }
    }

    const { error: updateError } = await supabase
      .from('orders')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', numericId);

    if (updateError) {
      console.error('Ошибка обновления статуса:', updateError);
      throw updateError;
    }

    await applyOrderStatusSideEffects({
      supabase,
      orderId: numericId,
      oldStatus: String(order.status),
      newStatus: status,
      deliveryDate: order.delivery_date,
      referredBy: order.referred_by,
      volume: order.volume,
      actorName: auth.user.full_name || 'Система',
    });

    return NextResponse.json({ success: true, message: 'Статус обновлён' });
  } catch (error: unknown) {
    console.error('Критическая ошибка update-status:', error);
    const message = error instanceof Error ? error.message : 'Ошибка сервера';
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}
