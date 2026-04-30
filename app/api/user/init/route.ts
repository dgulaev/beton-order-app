import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://nhudnzdgtidocwwzpqge.supabase.co';
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY!;

const supabase = createClient(supabaseUrl, supabaseAnonKey);

export async function POST(request: NextRequest) {
  try {
    const { userId } = await request.json();

    if (!userId) {
      return NextResponse.json({ success: false, message: 'No userId' }, { status: 400 });
    }

    // Проверяем, есть ли уже пользователь
    let { data: user } = await supabase
      .from('users')
      .select('referral_code, balance')
      .eq('user_id', userId)
      .single();

    // Если пользователя нет — создаём с реферальным кодом
    if (!user) {
      const referralCode = 'R' + Math.random().toString(36).substring(2, 8).toUpperCase();

      const { error } = await supabase
        .from('users')
        .insert([{
          user_id: userId,
          referral_code: referralCode,
          balance: 0,
        }]);

      if (error) console.error('User insert error:', error);

      user = { referral_code: referralCode, balance: 0 };
    }

    return NextResponse.json({
      success: true,
      referralCode: user.referral_code,
      balance: user.balance || 0,
    });

  } catch (error) {
    console.error('Init user error:', error);
    return NextResponse.json({ success: false }, { status: 500 });
  }
}