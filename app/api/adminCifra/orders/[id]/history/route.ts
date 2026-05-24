// app/api/adminCifra/orders/[id]/history/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;   // ← Важно: await params
  const orderId = parseInt(id);

  if (!orderId || isNaN(orderId)) {
    return NextResponse.json([], { status: 200 });
  }

  try {
    const { data, error } = await supabase
      .from('order_history')
      .select('*')
      .eq('order_id', orderId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('History fetch error:', error);
      return NextResponse.json([], { status: 200 });
    }

    return NextResponse.json(data || []);
  } catch (err) {
    console.error('History API error:', err);
    return NextResponse.json([], { status: 200 });
  }
}