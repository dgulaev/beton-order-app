// app/api/balance/redeem/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
  try {
    const { userId, amount, type, payoutDetails } = await request.json();

    const numericUserId = Number(userId);
    const numericAmount = Number(amount);

    if (!numericUserId || !numericAmount || numericAmount <= 0 || !['discount', 'cash'].includes(type)) {
      return NextResponse.json({ success: false, message: 'Неверные данные' }, { status: 400 });
    }

    const { data: user } = await supabase
      .from('users')
      .select('balance, full_name, phone')
      .eq('user_id', numericUserId)
      .single();

    if (!user || user.balance < numericAmount) {
      return NextResponse.json({ success: false, message: 'Недостаточно баллов' }, { status: 400 });
    }

    // Создаём запись о выводе
    const { data: redemption, error: redeemError } = await supabase
      .from('balance_redemptions')
      .insert({
        user_id: numericUserId,
        amount: numericAmount,
        type,
        status: type === 'discount' ? 'completed' : 'pending',
        payout_details: payoutDetails || null,
      })
      .select()
      .single();

    if (redeemError) throw redeemError;

    // Списываем баллы
    await supabase.rpc('decrement_balance', {
      p_user_id: numericUserId,
      p_points: numericAmount
    });

    // ==================== УВЕДОМЛЕНИЕ ДЛЯ АДМИНА ====================
    if (type === 'cash' && redemption) {
      console.log(`🔔 Попытка создать уведомление для вывода ${numericAmount} ₽ от пользователя ${numericUserId}`);

      const { error: notifyError } = await supabase
        .from('admin_notifications')
        .insert({
          type: 'cash_withdrawal',
          title: 'Запрос на вывод наличных',
          message: `${user.full_name || 'Клиент'} (${user.phone || 'нет телефона'}) запросил ${numericAmount} ₽ наличными`,
          user_id: numericUserId,           // ← важно: число
          redemption_id: redemption.id,     // ← bigint
          priority: 'high',
          is_read: false
        });

      if (notifyError) {
        console.error('❌ Ошибка создания уведомления:', notifyError);
      } else {
        console.log('✅ Уведомление для админа УСПЕШНО создано!');
      }
    }

    return NextResponse.json({ 
      success: true, 
      message: type === 'cash' ? 'Заявка на вывод наличных создана' : 'Баллы применены как скидка' 
    });

  } catch (error: any) {
    console.error('Redeem error:', error);
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}