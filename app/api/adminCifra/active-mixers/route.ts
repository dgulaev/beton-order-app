// app/api/adminCifra/active-mixers/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const withOrders = searchParams.get('withOrders') === 'true';

    let query = supabase
      .from('order_mixers')
      .select(`
        id,
        order_id,
        mixer_name,
        time,
        volume,
        status,
        created_at,
        updated_at,
        sort_order,
        orders!inner (
          id,
          delivery_date,
          delivery_time,
          organization_name,
          full_name,
          client_name,
          grade
        )
      `)
      .in('status', ['Загрузка', 'В пути', 'На объекте', 'Проблема'])
      .order('created_at', { ascending: false });

    const { data, error } = await query;

    if (error) throw error;

    const formatted = data.map((item: any) => ({
      id: item.id,
      number: item.mixer_name,
      orderId: item.order_id,
      volume: item.volume,
      time: item.time,
      status: item.status,
      created_at: item.created_at,
      updated_at: item.updated_at,
      // Новые поля для оператора
      delivery_date: item.orders?.delivery_date || null,
      delivery_time: item.orders?.delivery_time || null,
      organization_name: item.orders?.organization_name || null,
      client_name: item.orders?.client_name || item.orders?.full_name || null,
      concrete_grade: item.orders?.grade || null,
      client: item.orders?.organization_name || item.orders?.full_name || item.orders?.client_name || '—'
    }));

    console.log(`✅ Загружено ${formatted.length} активных миксеров (withOrders=${withOrders})`);

    return NextResponse.json(formatted);
  } catch (error: any) {
    console.error('Active mixers error:', error);
    return NextResponse.json([], { status: 500 });
  }
}