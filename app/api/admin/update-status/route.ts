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
    const { orderId, status, userId: adminUserId } = body;

    console.log('🔍 [Update Status] === ЗАПРОС ПОЛУЧЕН ===');
    console.log('Тело запроса:', JSON.stringify(body, null, 2));
    console.log('adminUserId:', adminUserId);

    const numericId = Number(orderId);

    // Получаем данные заказа
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('referred_by, volume, status, id')
      .eq('id', numericId)
      .single();

    console.log('📦 Данные заказа:', order);
    console.log('❌ orderError:', orderError);

    if (orderError || !order) {
      return NextResponse.json({ success: false, message: 'Заказ не найден' }, { status: 404 });
    }

    const bonusPoints = order.volume ? Math.round(Number(order.volume) * 100) : 0;
    console.log(`💰 Расчёт бонусов: ${bonusPoints} ₽ (volume = ${order.volume})`);

    // Защита финальных статусов
    if (order.status === 'completed' || order.status === 'cancelled') {
      console.log(`⛔ Финальный статус: ${order.status} — изменение запрещено`);
      return NextResponse.json({ success: false, message: `Статус "${order.status}" финальный.` }, { status: 400 });
    }

     // Обновляем статус заказа
    const { error: updateError } = await supabase
      .from('orders')
      .update({ status })
      .eq('id', numericId);

    if (updateError) {
      console.error('❌ Ошибка обновления статуса:', updateError);
      throw updateError;
    }

    console.log(`✅ Статус успешно изменён на: ${status}`);

    // ====================== ОБНОВЛЯЕМ СТАТУС В REFERRAL_TRANSACTIONS (Шаг 2) ======================
    if (order.referred_by) {
      const newTransactionStatus = status === 'completed' ? 'completed' : 'cancelled';

      const { error: txError } = await supabase
        .from('referral_transactions')
        .update({ 
          status: newTransactionStatus,
          processed_at: new Date().toISOString()
        })
        .eq('order_id', numericId)
        .eq('referrer_id', order.referred_by);

      if (txError) {
        console.error('⚠️ Не удалось обновить статус в referral_transactions:', txError);
      } else {
        console.log(`✅ Статус в referral_transactions обновлён на "${newTransactionStatus}"`);
      }
    }

    // ====================== РЕФЕРАЛЬНАЯ ЛОГИКА (ТОЛЬКО ПО ФИНАЛЬНЫМ СТАТУСАМ) ======================
    if (order.referred_by && bonusPoints > 0) {
      console.log(`🚀 Реферальная логика для заказа #${order.id} → статус "${status}"`);

      if (status === 'completed') {
        console.log(`📈 Начисляем ${bonusPoints} ₽ рефереру ${order.referred_by}`);

        const { error: incError } = await supabase.rpc('increment_balance', {
          user_id: order.referred_by,
          points: bonusPoints
        });

        if (incError) {
          console.error('❌ Ошибка increment_balance:', incError);
        } else {
          console.log(`✅ УСПЕШНО НАЧИСЛЕНО ${bonusPoints} ₽ рефереру!`);
        }

      } 
      else if (status === 'cancelled') {
        console.log(`📉 Заказ отменён — баллы НЕ списываем (они были только в potential)`);
        // Можно обновить статус записи в referral_transactions
        await supabase
          .from('referral_transactions')
          .update({ status: 'cancelled' })
          .eq('order_id', numericId)
          .eq('referrer_id', order.referred_by);
      }
      // Для остальных статусов (new, processing и т.д.) — ничего не делаем
    } else {
      console.log(`⚠️ Реферальная логика пропущена (referred_by = ${order.referred_by}, bonusPoints = ${bonusPoints})`);
    }

    console.log('🎉 [Update Status] === ЗАВЕРШЕНО УСПЕШНО ===');
    return NextResponse.json({ success: true, message: 'Статус обновлён' });

  } catch (error: any) {
    console.error('💥 КРИТИЧЕСКАЯ ОШИБКА update-status:', error);
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}