// app/api/adminCifra/order-logistics/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
  try {
    const { orderId, logisticsReady, autoStatus, status } = await request.json();

    if (!orderId) {
      return NextResponse.json({ success: false, message: 'orderId required' }, { status: 400 });
    }

    const updateData: any = {
      logistics_ready: logisticsReady ?? null,
      logistics_completed_at: logisticsReady ? new Date().toISOString() : null,
    };

    // Поддержка ручной смены статуса
    if (status) {
      updateData.status = status;
    } else if (autoStatus) {
      updateData.status = autoStatus;
    }

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