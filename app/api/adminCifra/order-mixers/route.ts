// app/api/adminCifra/order-mixers/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const FINAL_STATUSES = ['completed', 'cancelled'];
const STATUS_LABELS_RU: Record<string, string> = {
  new: 'Новая',
  processing: 'В работе',
  completed: 'Выполнена',
  cancelled: 'Отменена'
};

// GET — все назначенные миксеры (для дашборда), по одному orderId, или по
// списку orderIds (через запятую) — это сильно урезает выборку там, где
// нужны назначения только для заявок за конкретный день/месяц, а не за всё
// время (см. app/mobile/page.tsx).
export async function GET(request: NextRequest) {
  const orderId = request.nextUrl.searchParams.get('orderId');
  const orderIdsParam = request.nextUrl.searchParams.get('orderIds');

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
        on_site_at,
        unloaded_at,
        downtime_minutes,
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
    } else if (orderIdsParam) {
      const ids = orderIdsParam
        .split(',')
        .map((id) => parseInt(id.trim()))
        .filter((id) => Number.isFinite(id));
      if (ids.length > 0) {
        query = query.in('order_id', ids);
      } else {
        return NextResponse.json([]);
      }
    }

    const { data, error } = await query;

    if (error) throw error;

    const formatted = (data || []).map((item: any) => ({
      id: item.id,
      orderId: item.order_id,
      number: item.mixer_name,
      mixerName: item.mixer_name,
      time: item.time,
      volume: Number(item.volume || 0),
      status: item.status || 'Загрузка',
      client: item.orders?.organization_name || item.orders?.full_name || '—',
      onSiteAt: item.on_site_at || null,
      unloadedAt: item.unloaded_at || null,
      downtimeMinutes: item.downtime_minutes ?? null
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
    const { orderId, mixerName, time, volume, sortOrder, status, userName, userRole } = await request.json();

    if (!orderId || !mixerName || !time || volume === undefined) {
      return NextResponse.json({ error: 'Не все обязательные поля заполнены' }, { status: 400 });
    }

    // ==================== ПРОВЕРКА ФИНАЛЬНОГО СТАТУСА ЗАЯВКИ ====================
    const { data: currentOrder, error: orderFetchError } = await supabase
      .from('orders')
      .select('id, status, volume')
      .eq('id', orderId)
      .single();

    if (orderFetchError || !currentOrder) {
      return NextResponse.json({ error: 'Заявка не найдена' }, { status: 404 });
    }

    if (FINAL_STATUSES.includes(currentOrder.status)) {
      return NextResponse.json({
        error: `Заявка уже в финальном статусе "${STATUS_LABELS_RU[currentOrder.status] || currentOrder.status}" — добавление миксеров запрещено`
      }, { status: 400 });
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

    // ==================== ИСТОРИЯ: ДОБАВЛЕНИЕ МИКСЕРА ====================
    const historyEntries: any[] = [{
      order_id: orderId,
      action: `Добавил миксер ${mixerName} (${Number(volume).toFixed(2).replace(/\.?0+$/, '')} м³, время ${time})`,
      user_name: userName || 'Диспетчер',
      user_role: userRole || null
    }];

    // ==================== ПРАВИЛО 1: Новая → В работе при добавлении ЛЮБОГО миксера ====================
    let newOrderStatus: string | null = null;

    if (currentOrder.status === 'new') {
      newOrderStatus = 'processing';

      const { error: statusUpdateError } = await supabase
        .from('orders')
        .update({ status: newOrderStatus })
        .eq('id', orderId);

      if (statusUpdateError) {
        console.error('Не удалось автоматически перевести заявку в "В работе":', statusUpdateError);
      } else {
        historyEntries.push({
          order_id: orderId,
          action: `Автоматически изменил статус заявки с "Новая" на "В работе" (добавлен миксер ${mixerName})`,
          user_name: 'Система',
          user_role: 'system'
        });
      }
    }

    const { error: historyError } = await supabase.from('order_history').insert(historyEntries);
    if (historyError) {
      console.error('Ошибка записи истории при добавлении миксера:', historyError);
    }

   // console.log(`✅ Добавлен миксер ${mixerName} со статусом ${status || 'Загрузка'}`);

    return NextResponse.json({ success: true, data, newOrderStatus });

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

    // ==================== ПРОВЕРКА ФИНАЛЬНОГО СТАТУСА ЗАЯВКИ ====================
    const { data: mixer, error: mixerFetchError } = await supabase
      .from('order_mixers')
      .select('id, order_id, orders!inner(status)')
      .eq('id', id)
      .single();

    if (!mixerFetchError && mixer) {
      const orderStatus = (mixer as any).orders?.status;
      if (FINAL_STATUSES.includes(orderStatus)) {
        return NextResponse.json({
          error: `Заявка уже в финальном статусе "${STATUS_LABELS_RU[orderStatus] || orderStatus}" — удаление миксеров запрещено`
        }, { status: 400 });
      }
    }

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
