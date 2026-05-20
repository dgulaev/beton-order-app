// app/api/user/init/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
  try {
    const { userId, phone, referredBy } = await request.json();

    if (!userId) {
      return NextResponse.json({ success: false, message: 'userId required' }, { status: 400 });
    }

    let finalReferredBy: number | null = null;

    // Обработка реферальной ссылки
    if (referredBy) {
      if (typeof referredBy === 'string' && referredBy.startsWith('R')) {
        const { data: referrer } = await supabase
          .from('users')
          .select('user_id')
          .eq('referral_code', referredBy)
          .single();

        if (referrer) {
          finalReferredBy = referrer.user_id;
          console.log(`🔍 Реферер найден по коду ${referredBy} → user_id ${finalReferredBy}`);
        }
      } else if (typeof referredBy === 'number' && referredBy > 0) {
        finalReferredBy = referredBy;
      }
    }

    // Нормализация телефона
    let finalPhone = phone;
    if (finalPhone) {
      const digits = finalPhone.replace(/\D/g, '');
      finalPhone = digits.startsWith('7') ? '+' + digits : '+7' + digits.slice(1);
    }

    // Обновляем только нужные поля — НЕ трогаем referral_code!
    const { error } = await supabase
      .from('users')
      .update({
        phone: finalPhone,
        referred_by: finalReferredBy,
      })
      .eq('user_id', Number(userId));

    if (error) {
      console.error('Init update error:', error);
      return NextResponse.json({ success: false, message: error.message });
    }

    // Получаем актуальные данные пользователя
    const { data } = await supabase
      .from('users')
      .select('referral_code, balance, referred_by')
      .eq('user_id', Number(userId))
      .single();

    console.log(`✅ Пользователь ${userId} инициализирован. referred_by = ${finalReferredBy || 'null'}`);

    return NextResponse.json({
      success: true,
      referralCode: data?.referral_code || 'Загрузка...',
      balance: data?.balance || 0,
      referredBy: data?.referred_by
    });

  } catch (error: any) {
    console.error('Init error:', error);
    return NextResponse.json({ success: false, message: error.message || 'Неизвестная ошибка' });
  }
}