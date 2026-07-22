import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const FINAL_STATUSES = ['completed', 'cancelled'];

const STATUS_RU: Record<string, string> = {
  new: 'Новая',
  processing: 'В работе',
  completed: 'Выполнена',
  cancelled: 'Отменена',
};

export async function POST(request: NextRequest) {
  try {
    const { orderId, status, userName, userRole } = await request.json();

    if (!orderId || !status) {
      return NextResponse.json({ success: false, message: 'orderId и status обязательны' }, { status: 400 });
    }

    const numericId = Number(orderId);

    // Получаем текущий статус заказа
    const { data: order, error: fetchError } = await supabase
      .from('orders')
      .select('id, status, is_questionable')
      .eq('id', numericId)
      .single();

    if (fetchError || !order) {
      return NextResponse.json({ success: false, message: 'Заказ не найден' }, { status: 404 });
    }

    // Финальные статусы не перезаписываем
    if (FINAL_STATUSES.includes(order.status) && !FINAL_STATUSES.includes(status)) {
      return NextResponse.json({
        success: false,
        message: `Заявка уже в финальном статусе "${STATUS_RU[order.status] || order.status}" — изменение запрещено`,
      }, { status: 400 });
    }

    if (order.status === status) {
      return NextResponse.json({ success: true, message: 'Статус не изменился' });
    }

    const transitioningToProcessing = status === 'processing' && order.status !== 'processing';
    const wasQuestionable =
      order.is_questionable === true || order.is_questionable === 'true';

    // Обновляем статус (+ автоснятие метки «Под вопросом» при уходе в работу)
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

    // Записываем в историю
    const actor = userName || 'Диспетчер';
    const historyEntries: any[] = [{
      order_id: numericId,
      action: `Изменил статус заявки с "${STATUS_RU[order.status] || order.status}" на "${STATUS_RU[status] || status}"`,
      user_name: actor,
      user_role: userRole || null,
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

    return NextResponse.json({
      success: true,
      message: `Статус заказа #${orderId} изменён на "${STATUS_RU[status] || status}"`,
    });

  } catch (error: any) {
    console.error('Status API error:', error);
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
