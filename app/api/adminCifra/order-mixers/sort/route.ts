import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
  try {
    const { id, sortOrder } = await request.json();

    const { error } = await supabase
      .from('order_mixers')
      .update({ sort_order: sortOrder })
      .eq('id', id);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Sort order update error:', error);
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}