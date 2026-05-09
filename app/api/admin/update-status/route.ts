// app/api/admin/update-status/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { orderId, status } = body;

    console.log('🔍 [Update Status] === НАЧАЛО ЗАПРОСА ===');
    console.log('Полное тело от frontend:', JSON.stringify(body, null, 2));

    const numericId = Number(orderId);

    const { data: orderData } = await supabase
      .from('orders')
      .select('referred_by, volume, status')
      .eq('id', numericId)
      .single();

    const order = orderData as any;

    if (!order) {
      console.error(`❌ Order #${orderId} not found`);
      return NextResponse.json({ success: false, message: `Order #${orderId} not found` }, { status: 404 });
    }

    console.log(`✅ Заказ #${orderId} найден`);
    console.log(`   - status: ${order.status}`);
    console.log(`   - referred_by: ${order.referred_by || 'NULL'}`);
    console.log(`   - volume: ${order.volume}`);

    // === ЗАЩИТА ФИНАЛЬНЫХ СТАТУСОВ ===
    if (order.status === 'completed' || order.status === 'cancelled') {
      console.log(`⛔ ЗАПРЕЩЕНО: Финальный статус`);
      return NextResponse.json({ 
        success: false, 
        message: `Статус "${order.status}" финальный. Изменение невозможно.` 
      }, { status: 400 });
    }

    const bonusPoints = order.volume ? Math.round(Number(order.volume) * 100) : 0;

    // Обновляем статус
    await supabase
      .from('orders')
      .update({ status })
      .eq('id', numericId);

    console.log(`✅ Статус обновлён на ${status}`);

    // === РЕФЕРАЛЬНАЯ ЛОГИКА ===
    if (order.referred_by && bonusPoints > 0) {
      console.log(`🚀 РЕФЕРАЛЬНАЯ ЛОГИКА ЗАПУЩЕНА для пользователя ${order.referred_by}`);

      if (status === 'completed') {
        const { error } = await supabase.rpc('increment_balance', {
          user_id: order.referred_by,
          points: bonusPoints
        });
        if (!error) {
          console.log(`✅ УСПЕШНО НАЧИСЛЕНО ${bonusPoints} ₽ (заказ #${orderId})`);
        } else {
          console.error('❌ Ошибка increment_balance:', error);
        }
      } 
      else if (status === 'cancelled') {
        const { error } = await supabase.rpc('decrement_balance', {
          p_user_id: order.referred_by,
          p_points: bonusPoints
        });
        if (!error) {
          console.log(`✅ УСПЕШНО СПИСАНО ${bonusPoints} ₽ (заказ #${orderId})`);
        } else {
          console.error('❌ Ошибка decrement_balance:', error);
        }
      }
    } else {
      console.log(`⚠️ Реферальная логика ПРОПУЩЕНА (referred_by = ${order.referred_by || 'NULL'}, bonusPoints = ${bonusPoints})`);
    }

    console.log('🔍 [Update Status] === ЗАВЕРШЕНО ===');
    return NextResponse.json({ success: true });

  } catch (error: any) {
    console.error('❌ Update status error:', error);
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}