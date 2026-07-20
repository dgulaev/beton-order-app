// app/api/admin/mixer-trips/route.ts
// Рейсы конкретного миксера для просмотра администратором/диспетчером.
// Доступ: только сотрудники (role != 'client'). Водители не могут использовать
// этот эндпоинт для просмотра данных чужих миксеров.
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/supabaseAdmin';

async function requireStaff(request: NextRequest): Promise<boolean> {
  const userId = request.headers.get('x-user-id');
  if (!userId) return false;

  const { data } = await supabase
    .from('users')
    .select('role')
    .eq('user_id', parseInt(userId, 10))
    .maybeSingle();

  const role = data?.role;
  return !!role && role !== 'client';
}

export async function GET(request: NextRequest) {
  try {
    const isStaff = await requireStaff(request);
    if (!isStaff) {
      return NextResponse.json({ success: false, message: 'Доступ запрещён' }, { status: 403 });
    }

    const mixerId = request.nextUrl.searchParams.get('mixerId');
    const scope = request.nextUrl.searchParams.get('scope') || 'today';

    if (!mixerId) {
      return NextResponse.json({ success: false, message: 'mixerId обязателен' }, { status: 400 });
    }

    // Получаем данные миксера
    const { data: mixer, error: mixerError } = await supabase
      .from('mixers')
      .select('id, number, model, driver, phone, volume, type, status')
      .eq('id', parseInt(mixerId, 10))
      .maybeSingle();

    if (mixerError || !mixer) {
      return NextResponse.json({ success: false, message: 'Миксер не найден' }, { status: 404 });
    }

    // Получаем рейсы этого миксера
    let query = supabase
      .from('order_mixers')
      .select(`
        id, order_id, mixer_name, time, volume, status, created_at,
        loading_started_at, on_site_at, unloaded_at, downtime_minutes,
        orders (
          id, delivery_date, delivery_time, address, grade,
          organization_name, full_name, phone, comment, status
        )
      `)
      .eq('mixer_name', mixer.number)
      .order('created_at', { ascending: false });

    if (scope === 'today') {
      const todayStr = new Date().toISOString().slice(0, 10);
      const { data, error } = await query;
      if (error) throw error;

      const todayTrips = (data || []).filter((row: any) => {
        const d = row.orders?.delivery_date;
        return d && String(d).slice(0, 10) === todayStr;
      });

      return NextResponse.json({ success: true, mixer, trips: todayTrips.map(formatTrip) });
    }

    const limit = Math.min(parseInt(request.nextUrl.searchParams.get('limit') || '21', 10), 100);
    const offset = Math.max(parseInt(request.nextUrl.searchParams.get('offset') || '0', 10), 0);

    const { data, error } = await query.range(offset, offset + limit - 1);
    if (error) throw error;

    return NextResponse.json({ success: true, mixer, trips: (data || []).map(formatTrip) });

  } catch (error: any) {
    console.error('Admin mixer-trips GET error:', error);
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
    order: row.orders ? {
      id: row.orders.id,
      deliveryDate: row.orders.delivery_date,
      deliveryTime: row.orders.delivery_time,
      address: row.orders.address,
      grade: row.orders.grade,
      clientName: row.orders.organization_name || row.orders.full_name || '—',
      phone: row.orders.phone,
      comment: row.orders.comment,
      status: row.orders.status,
    } : null,
  };
}
