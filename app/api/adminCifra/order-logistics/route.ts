// app/api/adminCifra/order-logistics/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const FINAL_STATUSES = ['completed', 'cancelled'];
const STATUS_LABELS_RU: Record<string, string> = {
  new: 'Новая',
  processing: 'В работе',
  completed: 'Выполнена',
  cancelled: 'Отменена'
};

export async function POST(request: NextRequest) {
  try {
    const { orderId, logisticsReady } = await request.json();

    if (!orderId) {
      return NextResponse.json({ success: false, message: 'orderId required' }, { status: 400 });
    }

    // ==================== ЗАЩИТА ФИНАЛЬНЫХ ЗАЯВОК ====================
    const { data: currentOrder, error: orderFetchError } = await supabase
      .from('orders')
      .select('id, status')
      .eq('id', orderId)
      .single();

    if (orderFetchError || !currentOrder) {
      return NextResponse.json({ success: false, message: 'Заявка не найдена' }, { status: 404 });
    }

    if (FINAL_STATUSES.includes(currentOrder.status)) {
      return NextResponse.json({
        success: false,
        message: `Заявка уже в финальном статусе "${STATUS_LABELS_RU[currentOrder.status] || currentOrder.status}" — изменение логистики запрещено`
      }, { status: 400 });
    }

    // Статус заявки больше не меняется этим эндпоинтом — он управляется
    // исключительно автоматическими правилами (добавление миксера /
    // полная разгрузка). Здесь только фиксируется готовность логистики.
    const updateData: any = {
      logistics_ready: logisticsReady ?? null,
      logistics_completed_at: logisticsReady ? new Date().toISOString() : null,
    };

    const { error } = await supabase
      .from('orders')
      .update(updateData)
      .eq('id', orderId)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ 
      success: true, 
      message: 'Статус заказа обновлён' 
    });

  } catch (error: any) {
    console.error('Order logistics error:', error);
    return NextResponse.json({ 
      success: false, 
      message: error.message 
    }, { status: 500 });
  }
}