import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ==================== GET — Получить историю заказа ====================
export async function GET(request: NextRequest) {
  const orderId = request.nextUrl.searchParams.get('orderId');

  if (!orderId) {
    return NextResponse.json({ error: 'orderId required' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('order_history')
    .select('*')
    .eq('order_id', parseInt(orderId))
    .order('created_at', { ascending: false });

  if (error) {
    console.error('History fetch error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data || []);
}

// ==================== POST — Добавить запись в историю ====================
export async function POST(request: NextRequest) {
  try {
    const { order_id, action, user_name } = await request.json();

    if (!order_id || !action) {
      return NextResponse.json({ 
        success: false, 
        message: 'order_id и action обязательны' 
      }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('order_history')
      .insert([{
        order_id,
        action,
        user_name: user_name || 'Диспетчер'
      }])
      .select()
      .single();

    if (error) throw error;

    console.log(`📝 Добавлена запись в историю заказа #${order_id}`);

    return NextResponse.json({ success: true, data });

  } catch (error: any) {
    console.error('History insert error:', error);
    return NextResponse.json({ 
      success: false, 
      message: error.message || 'Не удалось добавить запись в историю' 
    }, { status: 500 });
  }
}