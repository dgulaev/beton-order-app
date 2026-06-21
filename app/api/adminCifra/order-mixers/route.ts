// app/api/adminCifra/order-mixers/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// GET — все назначенные миксеры (для дашборда) или по orderId
export async function GET(request: NextRequest) {
  const orderId = request.nextUrl.searchParams.get('orderId');

  try {
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
        orders (
          id,
          organization_name,
          full_name
        )
      `)
      .order('created_at', { ascending: false });

    // Если передан orderId — фильтруем по заказу
    if (orderId) {
      query = query.eq('order_id', parseInt(orderId));
    }

    const { data, error } = await query;

    if (error) throw error;

    const formatted = (data || []).map((item: any) => ({
      id: item.id,
      orderId: item.order_id,
      number: item.mixer_name,
      time: item.time,
      volume: Number(item.volume || 0),
      status: item.status || 'Загрузка',
      client: item.orders?.organization_name || item.orders?.full_name || '—'
    }));

   // console.log(`✅ Загружено ${formatted.length} записей order_mixers`);
    return NextResponse.json(formatted);

  } catch (error: any) {
    console.error('Order-mixers GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST — добавить миксер к заказу
export async function POST(request: NextRequest) {
  try {
    const { orderId, mixerName, time, volume, sortOrder, status } = await request.json();

    if (!orderId || !mixerName || !time || volume === undefined) {
      return NextResponse.json({ error: 'Не все обязательные поля заполнены' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('order_mixers')
      .insert([{
        order_id: orderId,
        mixer_name: mixerName,
        time: time,
        volume: volume,
        sort_order: sortOrder || 0,
        status: status || 'Загрузка'        // ← Теперь используем переданное значение
      }])
      .select()
      .single();

    if (error) throw error;

   // console.log(`✅ Добавлен миксер ${mixerName} со статусом ${status || 'Загрузка'}`);

    return NextResponse.json({ success: true, data });

  } catch (error: any) {
    console.error('Add mixer error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE — удалить миксер
export async function DELETE(request: NextRequest) {
  try {
    const { id } = await request.json();
    if (!id) return NextResponse.json({ error: 'id обязателен' }, { status: 400 });

    const { error } = await supabase
      .from('order_mixers')
      .delete()
      .eq('id', id);

    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Delete mixer error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}