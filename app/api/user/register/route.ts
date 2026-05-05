// app/api/user/register/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getSupabaseClient() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('❌ SUPABASE_URL или SUPABASE_SERVICE_ROLE_KEY не настроены');
  }

  return createClient(supabaseUrl, supabaseServiceKey);
}

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

    const supabase = getSupabaseClient();

    // Проверяем, существует ли пользователь
    const { data: existing } = await supabase
      .from('users')
      .select('id, role')
      .eq('phone', normalizedPhone)
      .single();

    if (existing) {
      return NextResponse.json({ 
        success: true, 
        userId: existing.id,
        role: existing.role 
      });
    }

    // Создаём нового пользователя
    const { data, error } = await supabase
      .from('users')
      .insert({
        phone: normalizedPhone,
        role: 'client',
        referral_code: 'R' + Math.random().toString(36).substring(2, 9).toUpperCase(),
        balance: 0,
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({
      success: true,
      userId: data.id,
      role: 'client'
    });

  } catch (error: any) {
    console.error('Register error:', error);
    return NextResponse.json({ 
      success: false, 
      message: 'Ошибка регистрации' 
    }, { status: 500 });
  }
}