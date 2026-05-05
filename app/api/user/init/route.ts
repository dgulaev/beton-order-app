// app/api/user/init/route.ts
import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

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

    // Получаем пользователя
    let { data: user, error } = await supabase
      .from('users')
      .select('id, referral_code, balance, role, referred_by')
      .eq('user_id', parsedUserId)
      .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 = no rows
      throw error;
    }

    if (!user) {
      const referralCode = 'R' + Math.random().toString(36).substring(2, 9).toUpperCase();

      const { data: newUser, error: insertError } = await supabase
        .from('users')
        .insert({
          user_id: parsedUserId,
          referral_code: referralCode,
          balance: 0,
          role: 'client',
          referred_by: null,
        })
        .select()
        .single();

      if (insertError) {
        console.error('Insert error:', insertError);
        
        if (insertError.code === '23505') {
          // Уже существует — повторно получаем
          const { data: retryUser } = await supabase
            .from('users')
            .select('id, referral_code, balance, role, referred_by')
            .eq('user_id', parsedUserId)
            .single();
          
          user = retryUser;
        } else {
          throw insertError;
        }
      } else {
        user = newUser;
      }
    }

    return NextResponse.json({
      success: true,
      referralCode: user?.referral_code || 'ERROR',
      balance: user?.balance || 0,
      role: user?.role || 'client'
    });

  } catch (error: any) {
    console.error('Init error:', error);
    return NextResponse.json({ 
      success: false, 
      message: error.message || 'Ошибка инициализации' 
    }, { status: 500 });
  }
}