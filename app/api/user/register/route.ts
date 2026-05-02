import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://nhudnzdgtidocwwzpqge.supabase.co';
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY!;

const supabase = createClient(supabaseUrl, supabaseAnonKey);

export async function POST(request: NextRequest) {
  try {
    const { phone } = await request.json();

    if (!phone) {
      return NextResponse.json({ success: false, message: 'Phone is required' }, { status: 400 });
    }

    // Нормализуем номер телефона
    const normalizedPhone = phone.replace(/\D/g, '');

    // Ищем пользователя по телефону
    let { data: existingUser } = await supabase
      .from('users')
      .select('user_id, referral_code, balance, role')
      .eq('phone', normalizedPhone)
      .single();

    let userId: number;
    let referralCode: string;

    if (existingUser) {
      // Пользователь уже есть — используем существующий
      userId = existingUser.user_id;
      referralCode = existingUser.referral_code;
    } else {
      // Создаём нового пользователя
      userId = Date.now(); // временный ID, можно потом заменить на UUID если нужно
      referralCode = 'R' + Math.random().toString(36).substring(2, 8).toUpperCase();

      const { error } = await supabase
        .from('users')
        .insert([{
          user_id: userId,
          phone: normalizedPhone,
          referral_code: referralCode,
          balance: 0,
          role: 'client'
        }]);

      if (error) throw error;
    }

    // ←←← Важно для RLS
    await supabase.rpc('set_current_user_id', { p_user_id: userId });

    return NextResponse.json({
      success: true,
      userId: userId,
      referralCode: referralCode
    });

  } catch (error) {
    console.error('Register error:', error);
    return NextResponse.json({ success: false, message: 'Server error' }, { status: 500 });
  }
}