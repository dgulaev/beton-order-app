import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://nhudnzdgtidocwwzpqge.supabase.co';
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY!;

const supabase = createClient(supabaseUrl, supabaseAnonKey);

export async function GET(request: NextRequest) {
  try {
    const userIdParam = request.nextUrl.searchParams.get('userId');

    console.log('📡 /api/admin/orders запрос для userId:', userIdParam);

    if (!userIdParam || userIdParam.trim() === '') {
      return NextResponse.json({ success: false, message: 'userId is required' }, { status: 400 });
    }

    const userId = parseInt(userIdParam, 10);
    if (isNaN(userId)) {
      return NextResponse.json({ success: false, message: 'Invalid userId format' }, { status: 400 });
    }

    console.log('🔧 Устанавливаем userId для RLS:', userId);

    // ←←← Важно для RLS
    const { error: rpcError } = await supabase.rpc('set_current_user_id', { p_user_id: userId });

    if (rpcError) {
      console.error('RPC set_current_user_id error:', rpcError);
    }

    const { data: orders, error } = await supabase
      .from('orders')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Supabase error:', error);
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    console.log('✅ Возвращаем заявок (админ):', orders?.length || 0);

    return NextResponse.json({ 
      success: true, 
      orders: orders || [] 
    });

  } catch (error: any) {
    console.error('Server error in /api/admin/orders:', error);
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}