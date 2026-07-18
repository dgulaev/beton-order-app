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
        loading_started_at,
        on_site_at,
        unloaded_at,
        downtime_minutes,
        orders!inner (
          id,
          status,
          delivery_date,
          delivery_time,
          organization_name,
          full_name,
          client_name,
          grade,
          volume
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
      loading_started_at: item.loading_started_at,
      onSiteAt: item.on_site_at || null,
      unloadedAt: item.unloaded_at || null,
      downtimeMinutes: item.downtime_minutes ?? null,
      // Новые поля для оператора
      delivery_date: item.orders?.delivery_date || null,
      delivery_time: item.orders?.delivery_time || null,
      organization_name: item.orders?.organization_name || null,
      client_name: item.orders?.client_name || item.orders?.full_name || null,
      concrete_grade: item.orders?.grade || null,
      client: item.orders?.organization_name || item.orders?.full_name || item.orders?.client_name || '—',
      // Общий плановый объём ВСЕЙ заявки (не путать с volume выше — это объём
      // конкретного рейса/миксера). Нужен для оценки "сколько рейсов ещё
      // осталось" в колонке "Прогресс" на странице оператора.
      order_volume: item.orders?.volume ?? null,
      // Статус самой заявки — нужен, чтобы кнопки "Начать"/"Загружен" могли
      // сразу и понятно отказать, если заявку уже закрыли (диспетчер/менеджер
      // руками поставили "Выполнена"/"Отменена"), не отправляя запрос на
      // сервер и не создавая мусорных записей в production_logs.
      order_status: item.orders?.status ?? null
    }));

   // console.log(`✅ Загружено ${formatted.length} активных миксеров (withOrders=${withOrders})`);

    return NextResponse.json(formatted);
  } catch (error: any) {
    console.error('Active mixers error:', error);
    return NextResponse.json([], { status: 500 });
  }
}