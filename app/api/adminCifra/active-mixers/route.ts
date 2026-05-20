// app/api/adminCifra/active-mixers/route.ts
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  try {
    const { data, error } = await supabase
      .from('order_mixers')
      .select(`
        id,
        order_id,
        mixer_name,
        time,
        volume,
        status,
        orders!inner (
          id,
          organization_name,
          full_name
        )
      `)
      .in('status', ['Загрузка', 'В пути', 'На объекте', 'Проблема']) // ← только активные
      .order('created_at', { ascending: false });

    if (error) throw error;

    const formatted = data.map((item: any) => ({
      id: item.id,
      number: item.mixer_name,
      orderId: item.order_id,
      volume: item.volume,
      time: item.time,
      status: item.status,
      client: item.orders?.organization_name || item.orders?.full_name || '—'
    }));

    console.log(`✅ Загружено ${formatted.length} активных миксеров`);
    return NextResponse.json(formatted);
  } catch (error: any) {
    console.error('Active mixers error:', error);
    return NextResponse.json([], { status: 500 });
  }
}