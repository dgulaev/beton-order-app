import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { findAnyUserByPhone, findClientByPhone } from '@/lib/clientUsers';
import { toStoredPhone } from '@/lib/phone';

export async function POST(request: NextRequest) {
  try {
    const { phone, fullName, referredBy } = await request.json();

    if (!phone) {
      return NextResponse.json({ success: false, message: 'Номер телефона обязателен' }, { status: 400 });
    }

    const phoneWithPlus = toStoredPhone(phone);
    if (!phoneWithPlus) {
      return NextResponse.json(
        { success: false, message: 'Некорректный телефон (нужен полный номер РФ)' },
        { status: 400 },
      );
    }

    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const existingClient = await findClientByPhone(supabase, phone);
    if (existingClient) {
      return NextResponse.json({
        success: true,
        userId: existingClient.user_id,
        role: 'client',
        referralCode: null,
        fullName: existingClient.full_name,
      });
    }

    const anyUser = await findAnyUserByPhone(supabase, phone);
    if (anyUser && String(anyUser.role || '').toLowerCase() !== 'client') {
      return NextResponse.json({
        success: false,
        message: 'Этот номер занят учётной записью сотрудника. Используй другой телефон.',
      }, { status: 409 });
    }

    const userId = Date.now() + Math.floor(Math.random() * 1000);
    const referralCode = 'R' + Math.random().toString(36).substring(2, 8).toUpperCase();
    const referredByNum = referredBy != null && Number.isFinite(Number(referredBy))
      ? Number(referredBy)
      : null;

    const { data, error } = await supabase
      .from('users')
      .insert({
        user_id: userId,
        phone: phoneWithPlus,
        full_name: fullName || null,
        role: 'client',
        referral_code: referralCode,
        balance: 0,
        referred_by: referredByNum,
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
      fullName: data.full_name,
    });
  } catch (error: any) {
    console.error('Register error:', error);
    return NextResponse.json({
      success: false,
      message: error.message || 'Ошибка регистрации',
    }, { status: 500 });
  }
}
