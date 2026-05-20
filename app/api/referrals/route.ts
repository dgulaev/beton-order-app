import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://nhudnzdgtidocwwzpqge.supabase.co';
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY!;

const supabase = createClient(supabaseUrl, supabaseAnonKey);

export async function GET(request: NextRequest) {
  try {
    const userIdParam = request.nextUrl.searchParams.get('userId');

    console.log('🔍 Запрос рефералов для user_id:', userIdParam);

    if (!userIdParam || userIdParam.trim() === '') {
      return NextResponse.json({ success: false, message: 'userId is required' }, { status: 400 });
    }

    const userId = parseInt(userIdParam, 10);
    if (isNaN(userId)) {
      return NextResponse.json({ success: false, message: 'Invalid userId' }, { status: 400 });
    }

    await supabase.rpc('set_current_user_id', { p_user_id: userId });

    const { data: referrals, error } = await supabase
      .from('users')
      .select('user_id, referral_code, balance, created_at')
      .eq('referred_by', userId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    return NextResponse.json({ success: true, referrals: referrals || [] });

  } catch (error: any) {
    console.error('Server error in /api/referrals:', error);
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}