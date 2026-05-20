import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function GET(request: NextRequest) {
  try {
    const userIdParam = request.nextUrl.searchParams.get('userId');

    console.log('📡 [API/orders] Запрос для userId:', userIdParam);

    if (!userIdParam || userIdParam.trim() === '') {
      return NextResponse.json({ success: false, message: 'userId is required' }, { status: 400 });
    }

    const userId = parseInt(userIdParam, 10);
    if (isNaN(userId)) {
      return NextResponse.json({ success: false, message: 'Invalid userId format' }, { status: 400 });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: orders, error } = await supabase
      .from('orders')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('❌ Supabase error in /api/orders:', error);
      return NextResponse.json({ 
        success: false, 
        message: error.message,
        details: error.details 
      }, { status: 500 });
    }

    console.log(`✅ [API/orders] Найдено ${orders?.length || 0} заявок для userId=${userId}`);

    return NextResponse.json({ 
      success: true, 
      orders: orders || [] 
    });

  } catch (error: any) {
    console.error('💥 Server crash in /api/orders:', error);
    return NextResponse.json({ 
      success: false, 
      message: error.message || 'Internal server error' 
    }, { status: 500 });
  }
}