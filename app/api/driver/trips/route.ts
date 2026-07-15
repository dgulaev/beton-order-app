// app/api/driver/trips/route.ts
// Рейсы водителя: "Мои рейсы на сегодня" (scope=today) и "История поездок"
// (scope=history). Доступ проверяется на каждый запрос через requireDriver —
// водитель видит только рейсы СВОЕГО миксера (по номеру).
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/supabaseAdmin';
import { requireDriver } from '@/lib/driverAuth';

export async function GET(request: NextRequest) {
  try {
    const driver = await requireDriver(request);
    if (!driver) {
      return NextResponse.json({ success: false, message: 'Доступ запрещён' }, { status: 403 });
    }

    const scope = request.nextUrl.searchParams.get('scope') || 'today';

    let query = supabase
      .from('order_mixers')
      .select(
        `
        id,
        order_id,
        mixer_name,
        time,
        volume,
        status,
        created_at,
        loading_started_at,
        on_site_at,
        unloaded_at,
        downtime_minutes,
        orders (
          id,
          delivery_date,
          delivery_time,
          address,
          grade,
          organization_name,
          full_name,
          phone,
          comment,
          status
        )
      `
      )
      .eq('mixer_name', driver.number)
      .order('created_at', { ascending: false });

    if (scope === 'today') {
      const todayStr = new Date().toISOString().slice(0, 10);
      // order_mixers сам по себе не хранит дату доставки — фильтруем на дату заказа после запроса,
      // поскольку PostgREST не даёт фильтровать по полю вложенной таблицы через .eq() на этом синтаксисе join.
      const { data, error } = await query;
      if (error) throw error;

      const todayTrips = (data || []).filter((row: any) => {
        const d = row.orders?.delivery_date;
        if (!d) return false;
        return String(d).slice(0, 10) === todayStr;
      });

      return NextResponse.json({ success: true, trips: todayTrips.map(formatTrip) });
    }

    // history — последние 200 рейсов, сгруппировать по дням делает фронтенд
    const { data, error } = await query.limit(200);
    if (error) throw error;

    return NextResponse.json({ success: true, trips: (data || []).map(formatTrip) });
  } catch (error: any) {
    console.error('Driver trips GET error:', error);
    return NextResponse.json({ success: false, message: error.message || 'Ошибка сервера' }, { status: 500 });
  }
}

function formatTrip(row: any) {
  return {
    id: row.id,
    orderId: row.order_id,
    mixerName: row.mixer_name,
    time: row.time,
    volume: Number(row.volume || 0),
    status: row.status || 'Загрузка',
    createdAt: row.created_at,
    loadingStartedAt: row.loading_started_at || null,
    onSiteAt: row.on_site_at || null,
    unloadedAt: row.unloaded_at || null,
    downtimeMinutes: row.downtime_minutes ?? null,
    order: row.orders
      ? {
          id: row.orders.id,
          deliveryDate: row.orders.delivery_date,
          deliveryTime: row.orders.delivery_time,
          address: row.orders.address,
          grade: row.orders.grade,
          clientName: row.orders.organization_name || row.orders.full_name || '—',
          phone: row.orders.phone,
          comment: row.orders.comment,
          status: row.orders.status,
        }
      : null,
  };
}
