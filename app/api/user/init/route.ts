// app/api/user/init/route.ts
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
    const { userId } = await request.json();

    if (!userId) {
      return NextResponse.json({ 
        success: false, 
        message: 'userId обязателен' 
      }, { status: 400 });
    }

    const parsedUserId = typeof userId === 'string' ? parseInt(userId, 10) : Number(userId);

    const supabase = getSupabaseClient();

    let { data: user, error } = await supabase
      .from('users')
      .select('referral_code, balance, role')
      .eq('user_id', parsedUserId)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.error('Init query error:', error);
      throw error;
    }

    // Если пользователя нет — создаём
    if (!user) {
      const referralCode = 'R' + Math.random().toString(36).substring(2, 9).toUpperCase();

      const { data: newUser, error: insertError } = await supabase
        .from('users')
        .insert({
          user_id: parsedUserId,
          referral_code: referralCode,
          balance: 0,
          role: 'client',
        })
        .select()
        .single();

      if (insertError && insertError.code !== '23505') {
        throw insertError;
      }

      user = newUser || { referral_code: referralCode, balance: 0, role: 'client' };
    }

    // ←←← ИСПРАВЛЕННЫЙ БЛОК
    return NextResponse.json({
      success: true,
      referralCode: user?.referral_code || 'ERROR',
      balance: user?.balance ?? 0,
      role: user?.role || 'client'
    });

  } catch (error: any) {
    console.error('Init error:', error);
    return NextResponse.json({ 
      success: false, 
      referralCode: 'ERROR',
      balance: 0,
      role: 'client'
    });
  }
}