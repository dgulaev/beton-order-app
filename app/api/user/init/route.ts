import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://nhudnzdgtidocwwzpqge.supabase.co';
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY!;

const supabase = createClient(supabaseUrl, supabaseAnonKey);

export async function POST(request: NextRequest) {
  try {
    const { userId } = await request.json();

    if (!userId || userId.toString().trim() === '') {
      return NextResponse.json({ success: false, message: 'No userId' }, { status: 400 });
    }

    const parsedUserId = parseInt(userId.toString(), 10);
    if (isNaN(parsedUserId)) {
      return NextResponse.json({ success: false, message: 'Invalid userId' }, { status: 400 });
    }

    // ←←← Важно для RLS
    await supabase.rpc('set_current_user_id', { p_user_id: parsedUserId });

    // Проверяем, есть ли уже пользователь
    let { data: user } = await supabase
      .from('users')
      .select('referral_code, balance, role')
      .eq('user_id', parsedUserId)
      .single();

    // Если пользователя нет — создаём
    if (!user) {
      const referralCode = 'R' + Math.random().toString(36).substring(2, 8).toUpperCase();

      const { error } = await supabase
        .from('users')
        .insert([{
          user_id: parsedUserId,
          referral_code: referralCode,
          balance: 0,
          role: 'client'
        }]);

      if (error) {
        console.error('User insert error:', error);
        // Если дубликат — просто продолжаем (уже существует)
        if (error.code !== '23505') throw error;
      }

      user = { referral_code: referralCode, balance: 0, role: 'client' };
    }

    return NextResponse.json({
      success: true,
      referralCode: user.referral_code,
      balance: user.balance || 0,
      role: user.role || 'client'
    });

  } catch (error) {
    console.error('Init user error:', error);
    return NextResponse.json({ success: false }, { status: 500 });
  }
}