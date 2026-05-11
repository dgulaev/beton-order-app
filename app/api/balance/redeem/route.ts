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

    if (!userId || !amount || amount <= 0 || !['discount', 'cash'].includes(type)) {
      return NextResponse.json({ success: false, message: 'Неверные данные' }, { status: 400 });
    }

    const numericUserId = Number(userId);
    const numericAmount = Number(amount);

    // Проверяем баланс
    const { data: user } = await supabase
      .from('users')
      .select('balance')
      .eq('user_id', numericUserId)
      .single();

    if (!user || user.balance < numericAmount) {
      return NextResponse.json({ success: false, message: 'Недостаточно баллов' }, { status: 400 });
    }

    const redemptionData = {
      user_id: numericUserId,
      amount: numericAmount,
      type,
      status: type === 'discount' ? 'completed' : 'pending',
      payout_details: payoutDetails || null,
      processed_at: type === 'discount' ? new Date().toISOString() : null,
    };

    const { data, error } = await supabase
      .from('balance_redemptions')
      .insert(redemptionData)
      .select()
      .single();

    if (error) throw error;

    // Списываем баллы
    const { error: decrementError } = await supabase.rpc('decrement_balance', {
      p_user_id: numericUserId,
      p_points: numericAmount
    });

    if (decrementError) {
      console.error('Ошибка списания баллов:', decrementError);
    }

    console.log(`✅ Погашение ${numericAmount} баллов (${type}) для пользователя ${userId}`);

    return NextResponse.json({ 
      success: true, 
      redemption: data,
      message: type === 'discount' 
        ? `Баллы успешно применены как скидка (${numericAmount} ₽)` 
        : `Заявка на вывод ${numericAmount} ₽ создана. Ожидайте подтверждения администратора.` 
    });

  } catch (error: any) {
    console.error('Redeem error:', error);
    return NextResponse.json({ success: false, message: error.message || 'Внутренняя ошибка сервера' }, { status: 500 });
  }
}