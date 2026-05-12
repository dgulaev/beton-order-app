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

    // Проверка баланса пользователя (вашего)
    const { data: user } = await supabase
      .from('users')
      .select('balance')
      .eq('user_id', numericUserId)
      .single();

    if (!user || user.balance < numericAmount) {
      return NextResponse.json({ success: false, message: 'Недостаточно баллов' }, { status: 400 });
    }

    // Создаём запись о выводе / погашении
    const { error: redeemError } = await supabase
      .from('balance_redemptions')
      .insert({
        user_id: numericUserId,
        amount: numericAmount,
        type,
        status: type === 'discount' ? 'completed' : 'pending',
        payout_details: payoutDetails || null,
        created_at: new Date().toISOString()
      });

    if (redeemError) throw redeemError;

    // Списываем баллы с вашего общего баланса
    const { error: decrementError } = await supabase.rpc('decrement_balance', {
      p_user_id: numericUserId,     // используем правильный параметр
      p_points: numericAmount
    });

    if (decrementError) {
      console.error('Ошибка списания баллов:', decrementError);
    }

    // === Если выбран конкретный реферал — создаём отрицательную запись ===
    if (payoutDetails?.source_referrer_id) {
      const referrerId = Number(payoutDetails.source_referrer_id);

      const { error: refError } = await supabase
        .from('referral_transactions')
        .insert({
          referrer_id: referrerId,
          referred_user_id: numericUserId,
          order_id: null,
          volume: 0,
          potential_bonus: -numericAmount,
          status: 'completed',
          comment: `Вывод наличными пользователем ${userId}`
        });

      if (refError) {
        console.error('Ошибка создания отрицательной записи у реферера:', refError);
      } else {
        console.log(`✅ Создано списание -${numericAmount} ₽ у реферера ${referrerId}`);
      }
    }

    return NextResponse.json({ 
      success: true, 
      message: type === 'discount' 
        ? 'Баллы успешно применены как скидка' 
        : 'Заявка на вывод успешно создана' 
    });

  } catch (error: any) {
    console.error('Redeem error:', error);
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}