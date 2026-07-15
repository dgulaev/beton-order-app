// app/api/adminCifra/mixer-history/route.ts
// Полная история рейсов конкретного миксера для администраторов.
// Возвращает order_mixers + orders JOIN, статистику, фильтр по дате.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/supabaseAdmin';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const mixerName = searchParams.get('mixer_name');
    const from = searchParams.get('from');   // ISO date string YYYY-MM-DD
    const to = searchParams.get('to');       // ISO date string YYYY-MM-DD

    if (!mixerName) {
      return NextResponse.json({ success: false, message: 'mixer_name is required' }, { status: 400 });
    }

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
      .eq('mixer_name', mixerName)
      .order('created_at', { ascending: false })
      .limit(500);

    const { data, error } = await query;
    if (error) throw error;

    const rows = data || [];

    // Фильтр по дате доставки на стороне сервера (delivery_date из orders)
    const filtered = rows.filter((row: any) => {
      const d = row.orders?.delivery_date;
      if (!d) return true;
      const dateStr = String(d).slice(0, 10);
      if (from && dateStr < from) return false;
      if (to && dateStr > to) return false;
      return true;
    });

    const trips = filtered.map((row: any) => ({
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
    }));

    // Статистика
    const completed = trips.filter((t: any) => t.status === 'Разгружен' || t.status === 'Возврат');
    const totalVolume = completed.reduce((sum: number, t: any) => sum + t.volume, 0);
    const totalDowntime = completed.reduce(
      (sum: number, t: any) => sum + (Number(t.downtimeMinutes) || 0),
      0
    );

    const stats = {
      totalTrips: trips.length,
      completedTrips: completed.length,
      totalVolume: Math.round(totalVolume * 10) / 10,
      totalDowntimeMinutes: totalDowntime,
    };

    return NextResponse.json({ success: true, trips, stats });
  } catch (error: any) {
    console.error('mixer-history GET error:', error);
    return NextResponse.json(
      { success: false, message: error.message || 'Ошибка сервера' },
      { status: 500 }
    );
  }
}
