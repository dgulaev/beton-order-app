// app/api/admin/update-status/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

export async function POST(request: NextRequest) {
  try {
    const { orderId, status, userId: adminUserId } = await request.json();

    if (!orderId || !status) {
      return NextResponse.json({ success: false, message: 'orderId and status required' }, { status: 400 });
    }

    console.log(`🔄 [Update Status] Заказ #${orderId} → ${status} (админ: ${adminUserId})`);

    // Получаем данные заказа
    const { data: order, error: fetchError } = await supabase
      .from('orders')
      .select('referred_by, volume, status')
      .eq('id', orderId)
      .single();

    if (fetchError || !order) {
      console.error('Order not found:', fetchError);
      return NextResponse.json({ success: false, message: 'Order not found' }, { status: 404 });
    }

    // Обновляем статус заказа
    const { error: updateError } = await supabase
      .from('orders')
      .update({ status })
      .eq('id', orderId);

    if (updateError) {
      console.error('Update error:', updateError);
      throw updateError;
    }

    // === РЕФЕРАЛЬНАЯ ЛОГИКА ===
    if (order.referred_by && order.volume > 0) {
      const bonusPoints = Math.round(order.volume * 100);

      if (status === 'completed') {
        // Начисляем баллы рефереру
        const { error: bonusError } = await supabase.rpc('increment_balance', {
          user_id: order.referred_by,
          points: bonusPoints
        });

        if (bonusError) {
          console.error('Ошибка начисления баллов:', bonusError);
        } else {
          console.log(`💰 УСПЕШНО НАЧИСЛЕНО ${bonusPoints} ₽ рефереру ${order.referred_by} (заказ #${orderId})`);
        }

        // Обновляем статус транзакции
        await supabase
          .from('referral_transactions')
          .update({ 
            status: 'activated',
            activated_at: new Date().toISOString()
          })
          .eq('order_id', orderId)
          .eq('referrer_id', order.referred_by);

      } else if (status === 'cancelled') {
        // Сжигаем баллы
        await supabase
          .from('referral_transactions')
          .update({ status: 'cancelled' })
          .eq('order_id', orderId)
          .eq('referrer_id', order.referred_by);

        console.log(`❌ Баллы по заказу #${orderId} сожжены`);
      }
    }

    return NextResponse.json({ 
      success: true, 
      message: `Статус заказа #${orderId} обновлён на "${status}"` 
    });

  } catch (error: any) {
    console.error('❌ Update status error:', error);
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}