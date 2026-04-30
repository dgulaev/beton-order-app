import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://nhudnzdgtidocwwzpqge.supabase.co';
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY!;

const supabase = createClient(supabaseUrl, supabaseAnonKey);

export async function POST(request: NextRequest) {
  try {
    const { userId } = await request.json();
    console.log('🔍 [INIT] Received userId:', userId);

    if (!userId) {
      console.log('❌ [INIT] No userId provided');
      return NextResponse.json({ success: false, message: 'No userId' }, { status: 400 });
    }

    // Проверяем пользователя
    let { data: user, error: selectError } = await supabase
      .from('users')
      .select('referral_code, balance')
      .eq('user_id', userId)
      .single();

    if (selectError && selectError.code !== 'PGRST116') { // PGRST116 = no rows
      console.error('❌ [INIT] Select error:', selectError);
    }

    // Если пользователя нет — создаём
    if (!user) {
      const referralCode = 'R' + Math.random().toString(36).substring(2, 8).toUpperCase();
      console.log('🆕 [INIT] Creating new user with code:', referralCode);

      const { error: insertError } = await supabase
        .from('users')
        .insert([{
          user_id: userId,
          referral_code: referralCode,
          balance: 0,
        }]);

      if (insertError) {
        console.error('❌ [INIT] Insert error:', insertError);
      } else {
        user = { referral_code: referralCode, balance: 0 };
      }
    }

    console.log('✅ [INIT] Success, returning code:', user?.referral_code);

    return NextResponse.json({
      success: true,
      referralCode: user?.referral_code || 'ERROR',
      balance: user?.balance || 0,
    });

  } catch (error) {
    console.error('💥 [INIT] Critical error:', error);
    return NextResponse.json({ success: false, message: 'Server error' }, { status: 500 });
  }
}