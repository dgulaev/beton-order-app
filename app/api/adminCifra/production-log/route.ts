import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ==================== GET — Получить список отгруженных рейсов ====================
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const todayOnly = searchParams.get('today') === 'true';

    let query = supabase
      .from('production_logs')
      .select(`
        *,
        order_mixers!inner (
          podvizhnost
        ),
        orders!inner (
          delivery_date,
          delivery_time,
          volume
        )
      `)
      .order('created_at', { ascending: false });

    // Если запрос с ?today=true — фильтруем только сегодняшний день
    if (todayOnly) {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      query = query.gte('created_at', todayStart.toISOString());
    }

    const { data, error } = await query;

    if (error) {
      console.error('Supabase GET error:', error);
      return NextResponse.json([], { status: 500 });
    }

    // Добавляем podvizhnost в корень объекта
    const formatted = (data || []).map((log: any) => ({
      ...log,
      podvizhnost: log.order_mixers?.podvizhnost || log.podvizhnost || 'П3',
      // Общий плановый объём заявки — для расчёта колонки "Прогресс" на
      // странице оператора (см. active-mixers/route.ts для того же поля).
      order_volume: log.orders?.volume ?? null
    }));

    return NextResponse.json(formatted);
  } catch (error: any) {
    console.error('Production log GET error:', error);
    return NextResponse.json([], { status: 500 });
  }
}

// ==================== POST — Запись новой отгрузки ====================
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const { 
      order_id, 
      order_mixer_id, 
      mixer_name, 
      concrete_grade, 
      volume, 
      podvizhnost,
      start_time 
    } = body;

    const end_time = new Date().toISOString();

    const durationMinutes = start_time 
      ? Math.round((new Date(end_time).getTime() - new Date(start_time).getTime()) / 60000) 
      : null;

    // ⚠️ Защита от задвоения на сервере (доп. страховка к клиентской защите
    // от повторного клика): если для этого же миксера рейс уже был записан
    // за последнюю минуту — это повтор одного и того же запроса (двойной
    // клик/повторный fetch), а не новый рейс. Возвращаем уже существующую
    // запись вместо создания дубликата.
    if (order_mixer_id) {
      const oneMinuteAgo = new Date(Date.now() - 60000).toISOString();
      const { data: recent } = await supabase
        .from('production_logs')
        .select('*')
        .eq('order_mixer_id', order_mixer_id)
        .gte('created_at', oneMinuteAgo)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (recent) {
        return NextResponse.json({ success: true, data: recent, deduplicated: true });
      }
    }

    const { data, error } = await supabase
      .from('production_logs')
      .insert([{
        order_id,
        order_mixer_id,
        mixer_name,
        concrete_grade,
        volume,
        podvizhnost,
        start_time,
        end_time,
        duration_minutes: durationMinutes
      }])
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, data });

  } catch (error: any) {
    console.error('Production log POST error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}