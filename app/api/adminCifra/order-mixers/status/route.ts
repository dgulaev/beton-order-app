import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
  try {
    const { id, status, loading_started_at, podvizhnost } = await request.json();

    console.log('📥 [API] Получены данные:', { id, status, podvizhnost, loading_started_at });

    if (!id) {
      return NextResponse.json({ success: false, message: 'id обязателен' }, { status: 400 });
    }

    const allowedStatuses = ['Загрузка', 'В пути', 'На объекте', 'Разгружен', 'Возврат', 'Проблема'];

    // Проверяем статус только если он передан
    if (status && !allowedStatuses.includes(status)) {
      return NextResponse.json({ success: false, message: 'Недопустимый статус' }, { status: 400 });
    }

    // Получаем текущий миксер и заказ
    const { data: mixer, error: fetchError } = await supabase
      .from('order_mixers')
      .select(`
        *,
        orders!inner(id, status)
      `)
      .eq('id', id)
      .single();

    if (fetchError || !mixer) {
      return NextResponse.json({ success: false, message: `Миксер #${id} не найден` }, { status: 404 });
    }

    const orderId = mixer.order_id;

    // Подготовка данных для обновления
    const updateData: any = {
      updated_at: new Date().toISOString()
    };

    // Добавляем статус, если передан
    if (status) {
      updateData.status = status;
    }

    // Добавляем время начала загрузки
    if (status === 'Загрузка' && loading_started_at) {
      updateData.loading_started_at = loading_started_at;
    }

    // Добавляем подвижность (новое поле)
    if (podvizhnost !== undefined && podvizhnost !== null) {
      updateData.podvizhnost = podvizhnost;
      console.log(`✅ [API] Будем сохранять podvizhnost = ${podvizhnost} для id=${id}`);
    }

    // Обновляем статус миксера
    const { data: updatedData, error: updateError } = await supabase
      .from('order_mixers')
      .update(updateData)
      .eq('id', id)
      .select()
      .maybeSingle();

    if (updateError) {
      console.error('❌ Supabase update error:', updateError);
      throw updateError;
    }

    console.log('✅ [API] Успешно обновлено в базе:', updatedData);

    // === КРИТИЧНАЯ ЛОГИКА: ПРОВЕРКА ЗАВЕРШЕНИЯ ЗАКАЗА ===
    if (status === 'Разгружен') {
      const { data: remaining } = await supabase
        .from('order_mixers')
        .select('id')
        .eq('order_id', orderId)
        .neq('status', 'Разгружен');

      if (remaining?.length === 0) {
        await supabase
          .from('orders')
          .update({ 
            status: 'completed',
            logistics_ready: true,
            updated_at: new Date().toISOString()
          })
          .eq('id', orderId);

        console.log(`🎉 Заказ #${orderId} полностью выполнен`);
      }
    }

    return NextResponse.json({ 
      success: true, 
      message: `Статус миксера обновлён на "${status || '—'}"`,
      data: { mixerId: id, status, orderId, podvizhnost }
    });

  } catch (error: any) {
    console.error('❌ Ошибка обновления статуса миксера:', error);
    return NextResponse.json({ 
      success: false, 
      message: error.message || 'Внутренняя ошибка сервера' 
    }, { status: 500 });
  }
}