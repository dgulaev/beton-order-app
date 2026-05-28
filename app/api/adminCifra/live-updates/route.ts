// app/api/adminCifra/live-updates/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: NextRequest) {
  try {
    const lastChecked = request.nextUrl.searchParams.get('lastChecked');

    let query = supabase
      .from('orders')
      .select(`
        *,
        updater:users!orders_updated_by_fkey(role, full_name)
      `)
      .order('updated_at', { ascending: false })
      .limit(50);

    if (lastChecked) {
      query = query.gte('updated_at', lastChecked);
    }

    const { data: orders, error } = await query;

    if (error) {
      console.error('Live-updates API error:', error);
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    // Добавляем понятные поля для уведомлений
    const formattedOrders = orders.map((order: any) => ({
      ...order,
      author_role: order.updater?.role || 'Сотрудник',
      author_name: order.updater?.full_name || null
    }));

    return NextResponse.json({
      success: true,
      orders: formattedOrders || [],
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    console.error('❌ Live-updates API crash:', error);
    return NextResponse.json({ 
      success: false, 
      message: error.message 
    }, { status: 500 });
  }
}