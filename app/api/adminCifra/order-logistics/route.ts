// app/api/adminCifra/order-logistics/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
  try {
    const { orderId, logisticsReady, autoStatus } = await request.json();

    if (!orderId) {
      return NextResponse.json({ success: false, message: 'orderId обязателен' }, { status: 400 });
    }

    const updateData: any = {
      logistics_ready: Boolean(logisticsReady),           // надёжное преобразование в boolean
      logistics_completed_at: logisticsReady ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    };

    // Автоматическая смена статуса заказа
    if (autoStatus && ['new', 'processing', 'completed'].includes(autoStatus)) {
      updateData.status = autoStatus;
    }

    const { data, error } = await supabase
      .from('orders')
      .update(updateData)
      .eq('id', orderId)
      .select()          // ← возвращаем обновлённый заказ
      .single();

    if (error) throw error;

    return NextResponse.json({ 
      success: true, 
      message: logisticsReady 
        ? 'Логистика завершена + статус обновлён' 
        : 'Логистика обновлена',
      order: data
    });

  } catch (error: any) {
    console.error('Logistics API error:', error);
    return NextResponse.json({ 
      success: false, 
      message: error.message || 'Внутренняя ошибка' 
    }, { status: 500 });
  }
}