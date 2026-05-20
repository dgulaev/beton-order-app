// app/api/user/register/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(request: NextRequest) {
  try {
    const { phone, fullName, referredBy } = await request.json();

    if (!phone) {
      return NextResponse.json({ success: false, message: 'Номер телефона обязателен' }, { status: 400 });
    }

    const normalizedPhone = phone.replace(/\D/g, '');
    const phoneWithPlus = normalizedPhone.startsWith('7') 
      ? '+' + normalizedPhone 
      : '+7' + normalizedPhone.slice(1);

    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Проверяем существование пользователя
    const { data: existing } = await supabase
      .from('users')
      .select('user_id, role, referral_code, full_name')
      .eq('phone', phoneWithPlus)
      .limit(1);

    if (existing && existing.length > 0) {
      return NextResponse.json({ 
        success: true, 
        userId: existing[0].user_id,
        role: existing[0].role || 'client',
        referralCode: existing[0].referral_code,
        fullName: existing[0].full_name
      });
    }

    // Создаём нового пользователя
    const userId = Date.now();
    const referralCode = 'R' + Math.random().toString(36).substring(2, 8).toUpperCase();

    const { data, error } = await supabase
      .from('users')
      .insert({
        user_id: userId,
        phone: phoneWithPlus,
        full_name: fullName || null,           // ← Новое поле
        role: 'client',
        referral_code: referralCode,
        balance: 0,
        referred_by: null
      })
      .select()
      .single();

    if (error) throw error;

    console.log(`✅ Новый пользователь создан: ${userId} (${phoneWithPlus})`);
    return NextResponse.json({
      success: true,
      userId: data.user_id,
      role: 'client',
      referralCode: data.referral_code,
      fullName: data.full_name
    });

  } catch (error: any) {
    console.error('Register error:', error);
    return NextResponse.json({ 
      success: false, 
      message: error.message || 'Ошибка регистрации'
    }, { status: 500 });
  }
}