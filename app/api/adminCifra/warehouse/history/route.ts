import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  try {
    const { data, error } = await supabase
      .from('warehouse_operations')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(40);

    if (error) {
      console.error('GET history error:', error);
      return NextResponse.json([]);
    }

    return NextResponse.json(data || []);
  } catch (error) {
    console.error('GET history error:', error);
    return NextResponse.json([]);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const userName =
      typeof body.user_name === 'string' && body.user_name.trim()
        ? body.user_name.trim().slice(0, 120)
        : null;

    const { error } = await supabase
      .from('warehouse_operations')
      .insert({
        operation_type: body.operation_type || 'unknown',
        item_type: body.item_type || 'Неизвестно',
        amount: Number(body.amount || 0),
        old_value: Number(body.old_value || 0),
        new_value: Number(body.new_value || 0),
        unit: body.unit || 'л',
        user_name: userName,
        // НЕ отправляем 'action' — её нет в таблице
      });

    if (error) {
      console.error('POST history error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

   // console.log('✅ История успешно сохранена в базу');
    return NextResponse.json({ success: true });

  } catch (error: any) {
    console.error('💥 Ошибка POST history:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}