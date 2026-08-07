import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { ORDER_MUTATION_ROLES, requireAdminCifraStaff } from '@/lib/adminCifraAuth';
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
  try {
    const auth = await requireAdminCifraStaff(request, ORDER_MUTATION_ROLES);
    if (auth.error) {
      return NextResponse.json(
        { success: false, message: 'Нет доступа к изменению статуса' },
        { status: 403 },
      );
    }

    const { orderId, status, userName } = await request.json();

    if (!orderId || !status) {
      return NextResponse.json({ success: false, message: 'orderId и status обязательны' }, { status: 400 });
    }

    if (!isOrderStatus(status)) {
      return NextResponse.json(
        { success: false, message: 'Недопустимый статус заявки' },
        { status: 400 },
      );
    }

    const numericId = Number(orderId);
    if (!Number.isFinite(numericId)) {
      return NextResponse.json({ success: false, message: 'Некорректный orderId' }, { status: 400 });
    }

    const isAdmin = auth.user.role === 'admin';

    const { data: order, error: fetchError } = await supabase
      .from('orders')
      .select('id, status, is_questionable, delivery_date, referred_by, volume')
      .eq('id', numericId)
      .single();

    if (fetchError || !order) {
      return NextResponse.json({ success: false, message: 'Заказ не найден' }, { status: 404 });
    }

    if (isFinalOrderStatus(order.status) && !isAdmin) {
      return NextResponse.json({
        success: false,
        message: `Заявка уже в финальном статусе "${ORDER_STATUS_RU[order.status] || order.status}" — изменение запрещено`,
      }, { status: 400 });
    }

    if (order.status === status) {
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

    const transitioningToProcessing = status === 'processing' && order.status !== 'processing';
    const wasQuestionable =
      order.is_questionable === true || order.is_questionable === 'true';

    const { error: updateError } = await supabase
      .from('orders')
      .update({
        status,
        updated_at: new Date().toISOString(),
        ...(transitioningToProcessing && wasQuestionable ? { is_questionable: false } : {}),
      })
      .eq('id', numericId);

    if (updateError) {
      console.error('Ошибка обновления статуса:', updateError);
      return NextResponse.json({ success: false, message: updateError.message }, { status: 500 });
    }

    const actor =
      (typeof userName === 'string' && userName.trim() ? userName.trim() : null)
      || auth.user.full_name
      || 'Сотрудник';

    const historyEntries: Array<Record<string, unknown>> = [{
      order_id: numericId,
      action:
        `Изменил статус заявки с "${ORDER_STATUS_RU[order.status] || order.status}" на "${ORDER_STATUS_RU[status] || status}"` +
        (isFinalOrderStatus(order.status) && isAdmin ? ' (админ: правка конечного статуса)' : ''),
      user_name: actor,
      user_role: auth.user.role,
      field_name: 'status',
      old_value: order.status,
      new_value: status,
    }];

    if (transitioningToProcessing && wasQuestionable) {
      historyEntries.push({
        order_id: numericId,
        action: 'Автоматически снял метку "Под вопросом" (статус «В работе»)',
        user_name: 'Система',
        user_role: 'system',
        field_name: 'is_questionable',
        old_value: 'true',
        new_value: 'false',
      });
    }

    await supabase.from('order_history').insert(historyEntries);

    await applyOrderStatusSideEffects({
      supabase,
      orderId: numericId,
      oldStatus: String(order.status),
      newStatus: status,
      deliveryDate: order.delivery_date,
      referredBy: order.referred_by,
      volume: order.volume,
      actorName: actor,
    });

    return NextResponse.json({
      success: true,
      message: `Статус заказа #${orderId} изменён на "${ORDER_STATUS_RU[status] || status}"`,
    });

  } catch (error: unknown) {
    console.error('Status API error:', error);
    const message = error instanceof Error ? error.message : 'Ошибка сервера';
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}
