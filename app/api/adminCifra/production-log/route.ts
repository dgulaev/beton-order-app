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

    const orphanList = (orphanMixers || []).filter((m: any) => !loggedMixerIds.has(String(m.id)));

    // ==================== АТРИБУЦИЯ АВТОРА ОСИРОТЕВШЕЙ ЗАПИСИ ====================
    // order_mixers не хранит, кто именно поменял статус — эта информация есть
    // только в order_history (текстовый action + user_name/user_role). Чтобы в
    // UI оператора показывать реального автора ("Наталья Жукова" / "Менеджер"),
    // а не всегда одну и ту же надпись "Диспетчер", подтягиваем историю по всем
    // заявкам с осиротевшими рейсами и сопоставляем запись по имени миксера и
    // целевому статусу — формат строки см. lib/orderMixers.ts.
    let historyByOrder = new Map<number, any[]>();
    const orphanOrderIds = Array.from(new Set(orphanList.map((m: any) => m.order_id).filter((id: any) => id != null)));
    if (orphanOrderIds.length > 0) {
      // Берём и "Изменил статус миксера..." (основной источник — точный момент
      // перехода в "Разгружен"/"Возврат"), и "Добавил миксер..." (запасной
      // источник) — некоторые миксеры добавляются диспетчером уже готовой
      // записью о доставке, без отдельного шага смены статуса, и тогда в
      // истории есть только действие добавления.
      const { data: historyRows, error: historyError } = await supabase
        .from('order_history')
        .select('order_id, action, user_name, user_role, created_at')
        .in('order_id', orphanOrderIds)
        .or('action.ilike.Изменил статус миксера%,action.ilike.Добавил миксер%');

      if (historyError) {
        console.error('Production log orphan history error:', historyError);
      } else {
        for (const row of historyRows || []) {
          const list = historyByOrder.get(row.order_id) || [];
          list.push(row);
          historyByOrder.set(row.order_id, list);
        }
      }
    }

    const findOrphanActor = (m: any) => {
      const rows = historyByOrder.get(m.order_id);
      if (!rows || rows.length === 0) return null;

      const targetTime = new Date(m.unloaded_at || m.updated_at || m.created_at).getTime();
      const closestOf = (candidates: any[]) => {
        if (candidates.length === 0) return null;
        const sorted = [...candidates].sort(
          (a: any, b: any) =>
            Math.abs(new Date(a.created_at).getTime() - targetTime) -
            Math.abs(new Date(b.created_at).getTime() - targetTime)
        );
        return sorted[0];
      };

      // 1) Приоритет — явная смена статуса именно на текущий (Разгружен/Возврат).
      const targetMarker = `на "${m.status}"`;
      const statusChangeMatches = rows.filter(
        (r: any) => r.action?.startsWith('Изменил статус миксера') && r.action?.includes(m.mixer_name) && r.action?.includes(targetMarker)
      );
      const statusMatch = closestOf(statusChangeMatches);
      if (statusMatch) return statusMatch;

      // 2) Запасной вариант — запись о добавлении этого миксера в заявку
      // (актуально, если миксер сразу создавался в статусе "Разгружен").
      const addMatches = rows.filter(
        (r: any) => r.action?.startsWith('Добавил миксер') && r.action?.includes(m.mixer_name)
      );
      return closestOf(addMatches);
    };

    const orphanFormatted = orphanList.map((m: any) => {
      const timestamp = m.unloaded_at || m.updated_at || m.created_at;
      const actor = findOrphanActor(m);
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
        // Реальный автор изменения статуса (диспетчер/менеджер/админ), если
        // найден в истории заказа. Для старых записей до внедрения атрибуции
        // ролей (до 16.06.2026) user_role в истории может быть null — тогда
        // остаётся только имя ("Диспетчер" как обезличенная надпись).
        actor_name: actor?.user_name || null,
        actor_role: actor?.user_role || null,
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
      start_time,
      // Кто из операторов смены (Семён/Максим — общая учётка на всех) реально
      // зафиксировал этот рейс. Используется для статистики в карточке
      // "Оператор" (Клиенты → Стафф) — см. /api/adminCifra/staff/operator-stats.
      operator_name,
    } = body;

    const end_time = new Date().toISOString();

    const durationMinutes = start_time 
      ? Math.round((new Date(end_time).getTime() - new Date(start_time).getTime()) / 60000) 
      : null;

    // ==================== ЗАПРЕТ ЗАПИСИ РЕЙСА ПО УЖЕ ЗАКРЫТОЙ ЗАЯВКЕ ====================
    // Страховка на случай, если клиентская проверка на странице оператора
    // (устаревший кэш вкладки, другой клиент и т.п.) не сработала — см.
    // историю заявки #604 (18.07.2026), где именно так в production_logs
    // попала "мусорная" запись по уже "Выполненной" заявке, хотя сам миксер
    // так и не смог перейти в статус "В пути" (это уже блокирует
    // lib/orderMixers.ts). Без этой проверки лента "Отгружено сегодня" может
    // содержать рейсы, которых по факту не было.
    if (order_id) {
      const { data: orderForCheck } = await supabase
        .from('orders')
        .select('status')
        .eq('id', order_id)
        .maybeSingle();

      const finalStatusesRu: Record<string, string> = { completed: 'Выполнена', cancelled: 'Отменена' };
      if (orderForCheck?.status && finalStatusesRu[orderForCheck.status]) {
        return NextResponse.json(
          {
            success: false,
            message: `Заявка #${order_id} уже в статусе "${finalStatusesRu[orderForCheck.status]}" — запись рейса запрещена`,
          },
          { status: 400 }
        );
      }
    }

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
        operator_name: operator_name || null,
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