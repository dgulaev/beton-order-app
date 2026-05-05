// app/api/user/register/route.ts
import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

export async function POST(request: NextRequest) {
  try {
    const { phone } = await request.json();

    if (!phone) {
      return NextResponse.json({ 
        success: false, 
        message: 'Номер телефона обязателен' 
      }, { status: 400 });
    }

    const normalizedPhone = phone.replace(/\D/g, '');

    // Проверка существующего пользователя
    const { data: existing } = await supabase
      .from('users')
      .select('id, role')
      .eq('phone', normalizedPhone)
      .single();

    if (existing) {
      return NextResponse.json({ 
        success: true, 
        userId: existing.id,
        role: existing.role,
        message: 'Пользователь уже существует' 
      });
    }

    // Создание нового пользователя — роль client по умолчанию
    const { data, error } = await supabase
      .from('users')
      .insert({
        phone: normalizedPhone,
        role: 'client',                    // ← Обычный пользователь
        referral_code: 'R' + Math.random().toString(36).substring(2, 9).toUpperCase(),
        balance: 0,
        referred_by: null,
      })
      .select()
      .single();

    if (error) throw error;

    console.log(`✅ Новый client зарегистрирован: ${normalizedPhone}`);

    return NextResponse.json({
      success: true,
      userId: data.id,
      role: 'client'
    });

  } catch (error: any) {
    console.error('Register error:', error);
    return NextResponse.json({ 
      success: false, 
      message: error.message || 'Ошибка регистрации' 
    }, { status: 500 });
  }
}