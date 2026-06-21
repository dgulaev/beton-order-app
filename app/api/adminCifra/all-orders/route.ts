// app/api/adminCifra/all-orders/route.ts
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  try {
    const { data, error } = await supabase
      .from('orders')
      .select(`
        *,
        is_questionable
      `)
      .order('delivery_date', { ascending: true })
      .order('delivery_time', { ascending: true });

    if (error) {
      console.error('❌ Supabase error in all-orders:', error);
      return NextResponse.json([]); // Возвращаем пустой массив, чтобы ничего не падало
    }

    // console.log(`✅ all-orders: загружено ${data?.length || 0} заказов`);

    return NextResponse.json(data || []); // Возвращаем массив напрямую

  } catch (error: any) {
    console.error('❌ All orders API critical error:', error);
    return NextResponse.json([]); // Важно: всегда возвращаем массив
  }
}