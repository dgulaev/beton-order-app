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

    // ==================== "ОСИРОТЕВШИЕ" РЕЙСЫ ====================
    // production_logs пишется ТОЛЬКО кнопкой оператора "Загружен" (см.
    // persistCompletion на странице оператора). Но диспетчер (через модалку
    // заявки) и водитель (через свой апп) могут перевести миксер в статус
    // "Разгружен"/"Возврат" напрямую через /api/adminCifra/order-mixers/status
    // — эта ручка НЕ создаёт запись в production_logs. В итоге такой рейс
    // навечно "невидим" на странице оператора, а % отгрузки по заявке
    // никогда не доходит до 100, даже если по факту весь объём уже развезён
    // (заявка при этом уже "Выполнена" — см. lib/orderMixers.ts). Подтягиваем
    // такие миксеры напрямую из order_mixers и помечаем no_operator_record,
    // чтобы UI мог их визуально выделить.
    const loggedMixerIds = new Set(
      (data || [])
        .map((log: any) => log.order_mixer_id)
        .filter((id: any) => id != null)
        .map((id: any) => String(id))
    );

    const { data: orphanMixers, error: orphanError } = await supabase
      .from('order_mixers')
      .select(`
        id,
        order_id,
        mixer_name,
        volume,
        podvizhnost,
        status,
        created_at,
        updated_at,
        unloaded_at,
        orders!inner ( delivery_date, delivery_time, volume, grade )
      `)
      .in('status', ['Разгружен', 'Возврат']);

    if (orphanError) {
      console.error('Production log orphan mixers error:', orphanError);
    }

    const orphanFormatted = (orphanMixers || [])
      .filter((m: any) => !loggedMixerIds.has(String(m.id)))
      .map((m: any) => {
        const timestamp = m.unloaded_at || m.updated_at || m.created_at;
        return {
          id: `orphan-${m.id}`,
          order_id: m.order_id,
          order_mixer_id: m.id,
          mixer_name: m.mixer_name,
          concrete_grade: m.orders?.grade || null,
          volume: m.volume,
          podvizhnost: m.podvizhnost || 'П3',
          start_time: null,
          end_time: timestamp,
          duration_minutes: null,
          created_at: timestamp,
          order_volume: m.orders?.volume ?? null,
          // Помечаем — эта запись собрана из статуса миксера, а не создана
          // оператором через кнопку "Загружен". UI показывает её с пометкой.
          no_operator_record: true,
        };
      });

    if (todayOnly && orphanFormatted.length > 0) {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todayStartMs = todayStart.getTime();
      const filteredOrphans = orphanFormatted.filter((o: any) => {
        const t = o.created_at ? new Date(o.created_at).getTime() : NaN;
        return !isNaN(t) && t >= todayStartMs;
      });
      return NextResponse.json(
        [...formatted, ...filteredOrphans].sort(
          (a: any, b: any) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
        )
      );
    }

    const combined = [...formatted, ...orphanFormatted].sort(
      (a: any, b: any) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
    );

    return NextResponse.json(combined);
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