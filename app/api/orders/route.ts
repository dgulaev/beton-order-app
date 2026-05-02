import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://nhudnzdgtidocwwzpqge.supabase.co';
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY!;

const supabase = createClient(supabaseUrl, supabaseAnonKey);

export async function GET(request: NextRequest) {
  try {
    const userIdParam = request.nextUrl.searchParams.get('userId');

    console.log('📡 /api/orders запрос для userId:', userIdParam);

    if (!userIdParam || userIdParam.trim() === '') {
      return NextResponse.json({ success: false, message: 'userId is required' }, { status: 400 });
    }

    const userId = parseInt(userIdParam, 10);
    if (isNaN(userId)) {
      return NextResponse.json({ success: false, message: 'Invalid userId' }, { status: 400 });
    }

    await supabase.rpc('set_current_user_id', { p_user_id: userId });

    const { data: orders, error } = await supabase
      .from('orders')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    return NextResponse.json({ success: true, orders: orders || [] });

  } catch (error: any) {
    console.error('Server error in /api/orders:', error);
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}