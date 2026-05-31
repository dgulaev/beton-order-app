import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
  try {
    const { id, status } = await request.json();

    if (!id || !status) {
      return NextResponse.json({ success: false, message: 'id и status обязательны' }, { status: 400 });
    }

    const allowedStatuses = ['Загрузка', 'В пути', 'На объекте', 'Разгружен', 'Возврат', 'Проблема'];

    if (!allowedStatuses.includes(status)) {
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

    // Обновляем статус миксера
    const { error: updateError } = await supabase
      .from('order_mixers')
      .update({ 
        status,
        updated_at: new Date().toISOString()
      })
      .eq('id', id);

    if (updateError) throw updateError;

    // === КРИТИЧНАЯ ЛОГИКА: ПРОВЕРКА ЗАВЕРШЕНИЯ ЗАКАЗА ===
    if (status === 'Разгружен') {
      const { data: remaining } = await supabase
        .from('order_mixers')
        .select('id')
        .eq('order_id', orderId)
        .neq('status', 'Разгружен');

      if (remaining?.length === 0) {
        // Все миксеры разгружены → закрываем заказ
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
      message: `Статус миксера обновлён на "${status}"`,
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