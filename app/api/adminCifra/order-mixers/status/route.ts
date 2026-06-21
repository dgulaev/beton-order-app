import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);





export async function POST(request: NextRequest) {
  try {
    const { id, status, loading_started_at, podvizhnost } = await request.json();

   // console.log('📥 [API] Получены данные:', { id, status, podvizhnost, loading_started_at });

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
    const orderVolume = Number(mixer.orders?.volume || 0);

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

   // console.log('✅ [API] Миксер обновлён');

        // === ИСПРАВЛЕННАЯ ЛОГИКА ЗАВЕРШЕНИЯ ЗАКАЗА ===
    if (status === 'Разгружен') {
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

     // console.log(`📊 Проверка завершения: ${totalDelivered.toFixed(1)} / ${orderVolume.toFixed(1)} | Все разгружены: ${allUnloaded}`);

      if (allUnloaded && totalDelivered >= orderVolume * 0.98) {
        await supabase
          .from('orders')
          .update({ 
            status: 'completed',
            logistics_ready: true,
            updated_at: new Date().toISOString()
          })
          .eq('id', orderId);

       // console.log(`🎉 Заказ #${orderId} полностью выполнен (${totalDelivered.toFixed(1)} м³)`);
      } else if (allUnloaded) {
      //  console.log(`⚠️ Все миксеры разгружены, но объём неполный (${totalDelivered.toFixed(1)} / ${orderVolume.toFixed(1)})`);
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