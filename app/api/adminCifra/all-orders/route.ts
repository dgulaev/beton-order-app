// app/api/adminCifra/all-orders/route.ts
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function GET() {
  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data, error } = await supabase
      .from('orders')
      .select(`
        *,
        is_questionable
      `)
      .order('delivery_date', { ascending: true })
      .order('delivery_time', { ascending: true });

    if (error) {
      console.error('Supabase error (all-orders):', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    console.log(`✅ all-orders: загружено ${data?.length || 0} заказов`);

    return NextResponse.json(data || []);
  } catch (error: any) {
    console.error('All orders API error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}