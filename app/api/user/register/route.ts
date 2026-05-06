// app/api/user/register/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(request: NextRequest) {
  try {
    const { phone } = await request.json();

    if (!phone) {
      return NextResponse.json({ success: false, message: 'Номер телефона обязателен' }, { status: 400 });
    }

    const normalizedPhone = phone.replace(/\D/g, '');

    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Проверка существования (без .single() и id)
    const { data: existing } = await supabase
      .from('users')
      .select('user_id, role')
      .eq('phone', normalizedPhone)
      .limit(1);

    if (existing && existing.length > 0) {
      console.log('✅ Пользователь уже существует');
      return NextResponse.json({ 
        success: true, 
        userId: existing[0].user_id || Date.now(),
        role: existing[0].role || 'client'
      });
    }

    // Создаём нового пользователя
    const referralCode = 'R' + Math.random().toString(36).substring(2, 9).toUpperCase();

    const { data, error } = await supabase
      .from('users')
      .insert({
        phone: normalizedPhone,
        role: 'client',
        referral_code: referralCode,
        balance: 0,
        user_id: Date.now(),           // обязательное поле
      })
      .select()
      .single();

    if (error) {
      console.error('Insert error:', error);
      throw error;
    }

    console.log('✅ Новый пользователь создан');
    return NextResponse.json({
      success: true,
      userId: data.user_id || data.id,
      role: 'client'
    });

  } catch (error: any) {
    console.error('Register error:', error);
    return NextResponse.json({ 
      success: false, 
      message: 'Ошибка регистрации: ' + (error.message || 'Неизвестная ошибка')
    }, { status: 500 });
  }
}