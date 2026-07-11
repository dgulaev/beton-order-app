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

// Небольшой допуск на погрешность округления объёма (не 0.98 — почти строгое покрытие).
const VOLUME_EPSILON = 0.01;

export async function POST(request: NextRequest) {
  try {
    const { id, status, loading_started_at, podvizhnost, userName, userRole } = await request.json();

    if (!id) {
      return NextResponse.json({ success: false, message: 'id обязателен' }, { status: 400 });
    }

    const allowedStatuses = ['Загрузка', 'В пути', 'На объекте', 'Разгружен', 'Возврат', 'Проблема'];

    if (status && !allowedStatuses.includes(status)) {
      return NextResponse.json({ success: false, message: 'Недопустимый статус' }, { status: 400 });
    }

    // Получаем текущий миксер и заказ
    const { data: mixer, error: fetchError } = await supabase
      .from('order_mixers')
      .select(`
        *,
        orders!inner(id, status, volume)
      `)
      .eq('id', id)
      .single();

    if (fetchError || !mixer) {
      return NextResponse.json({ success: false, message: `Миксер #${id} не найден` }, { status: 404 });
    }

    const orderId = mixer.order_id;
    const orderStatus = mixer.orders?.status;
    const orderVolume = Number(mixer.orders?.volume || 0);
    const oldStatus = mixer.status || 'Загрузка';

    // ==================== ЗАЩИТА ФИНАЛЬНЫХ ЗАЯВОК ====================
    if (status && FINAL_STATUSES.includes(orderStatus)) {
      return NextResponse.json({
        success: false,
        message: `Заявка уже в финальном статусе "${STATUS_LABELS_RU[orderStatus] || orderStatus}" — изменение миксеров запрещено`
      }, { status: 400 });
    }

    // Подготовка данных для обновления
    const updateData: any = {
      updated_at: new Date().toISOString()
    };

    if (status) updateData.status = status;
    if (status === 'Загрузка' && loading_started_at) {
      updateData.loading_started_at = loading_started_at;
    }
    if (podvizhnost !== undefined && podvizhnost !== null) {
      updateData.podvizhnost = podvizhnost;
    }

    // Обновляем миксер
    const { data: updatedData, error: updateError } = await supabase
      .from('order_mixers')
      .update(updateData)
      .eq('id', id)
      .select()
      .maybeSingle();

    if (updateError) throw updateError;

    // ==================== ИСТОРИЯ: СМЕНА СТАТУСА МИКСЕРА ====================
    const historyEntries: any[] = [];

    if (status && status !== oldStatus) {
      const mixerName = mixer.mixer_name || `Миксер #${id}`;
      historyEntries.push({
        order_id: orderId,
        action: `Изменил статус миксера ${mixerName} с "${oldStatus}" на "${status}"`,
        user_name: userName || 'Диспетчер',
        user_role: userRole || null
      });
    }

    // ==================== ПРАВИЛО 2: авто-завершение заявки ====================
    if (status === 'Разгружен' && !FINAL_STATUSES.includes(orderStatus)) {
      const { data: allMixersData, error: fetchMixersError } = await supabase
        .from('order_mixers')
        .select('volume, status')
        .eq('order_id', orderId);

      const allMixers = allMixersData || [];

      if (fetchMixersError) {
        console.error('Ошибка получения миксеров:', fetchMixersError);
      }

      const totalDelivered = allMixers.reduce((sum: number, m: any) => {
        return sum + Number(m?.volume || 0);
      }, 0);

      const allUnloaded = allMixers.length > 0 &&
                         allMixers.every((m: any) => m?.status === 'Разгружен');

      if (allUnloaded && totalDelivered >= orderVolume - VOLUME_EPSILON) {
        const { error: completeError } = await supabase
          .from('orders')
          .update({
            status: 'completed',
            logistics_ready: true,
            updated_at: new Date().toISOString()
          })
          .eq('id', orderId);

        if (completeError) {
          console.error('Не удалось автоматически завершить заявку:', completeError);
        } else {
          historyEntries.push({
            order_id: orderId,
            action: `Автоматически изменил статус заявки с "В работе" на "Выполнена" (разгружено ${totalDelivered.toFixed(2).replace(/\.?0+$/, '')} м³ из ${orderVolume.toFixed(2).replace(/\.?0+$/, '')} м³)`,
            user_name: 'Система',
            user_role: 'system'
          });
        }
      }
    }

    if (historyEntries.length > 0) {
      const { error: historyError } = await supabase.from('order_history').insert(historyEntries);
      if (historyError) {
        console.error('Ошибка записи истории при смене статуса миксера:', historyError);
      }
    }

    return NextResponse.json({
      success: true,
      message: `Статус миксера обновлён на "${status || '—'}"`,
      data: { mixerId: id, status, orderId }
    });

  } catch (error: any) {
    console.error('❌ Ошибка обновления статуса миксера:', error);
    return NextResponse.json({
      success: false,
      message: error.message || 'Внутренняя ошибка сервера'
    }, { status: 500 });
  }
}
