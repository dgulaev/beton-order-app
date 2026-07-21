// app/api/adminCifra/orders/update/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, userRole, userName, ...updateData } = body;

    if (!id) {
      return NextResponse.json({ success: false, message: 'ID заявки обязателен' }, { status: 400 });
    }

   // console.log('🔄 [Update API] Обновление заявки #', id, 'от', userName || 'Система');

    // ==================== 1. ПОЛУЧЕНИЕ ТЕКУЩЕЙ ЗАЯВКИ ====================
    const { data: currentOrder, error: fetchError } = await supabase
      .from('orders')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !currentOrder) {
      return NextResponse.json({ success: false, message: 'Заявка не найдена' }, { status: 404 });
    }

    // ==================== 2. ЗАПРЕТ ИЗМЕНЕНИЯ СТАТУСА ДЛЯ ФИНАЛЬНЫХ ЗАЯВОК ====================
    const finalStatuses = ['completed', 'cancelled'];
    const isFinalOrder = finalStatuses.includes(currentOrder.status);

    if (isFinalOrder && updateData.status !== undefined) {
      delete updateData.status;
    //  console.log('⚠️ Попытка изменить статус финальной заявки — отклонено');
    }

    // ==================== 2b. ЗАПРЕТ РУЧНОГО ПЕРЕВОДА В "ВЫПОЛНЕНА" БЕЗ РЕАЛЬНОЙ РАЗГРУЗКИ ====================
    // Заявка #604 (18.07.2026) показала обходной путь бага #589: диспетчер
    // руками выбрала в селекторе статус "Выполнена", пока миксер так и
    // остался в статусе "Загрузка" (даже не выехал). В отличие от
    // автозавершения при разгрузке (см. lib/orderMixers.ts), эта ручная
    // смена статуса вообще не проверяла миксеры — отсюда и заявки
    // "Выполнена" с рейсом, зависшим в очереди на загрузку у оператора.
    // Правило то же самое, что и для автозавершения: все рейсы разгружены
    // и их суммарный объём покрывает объём заявки. Если рейсов нет вообще —
    // не блокируем (могут быть заявки без миксеров, напр. отменённые).
    if (!isFinalOrder && updateData.status === 'completed') {
      const { data: mixersForCheck } = await supabase
        .from('order_mixers')
        .select('volume, status')
        .eq('order_id', id);

      const mixers = mixersForCheck || [];
      if (mixers.length > 0) {
        const allUnloaded = mixers.every((m: any) => m?.status === 'Разгружен');
        const totalDelivered = mixers.reduce((sum: number, m: any) => sum + Number(m?.volume || 0), 0);
        const effectiveVolume = updateData.volume !== undefined ? Number(updateData.volume) : Number(currentOrder.volume || 0);
        const VOLUME_EPSILON = 0.01;

        if (!allUnloaded || totalDelivered < effectiveVolume - VOLUME_EPSILON) {
          return NextResponse.json({
            success: false,
            message: allUnloaded
              ? `Нельзя завершить заявку — разгружено ${totalDelivered} м³ из ${effectiveVolume} м³. Добавьте недостающий объём или поправьте объём миксера.`
              : 'Нельзя завершить заявку — не все рейсы разгружены. Переведите миксеры в статус "Разгружен".',
          }, { status: 400 });
        }
      }
    }

    // ==================== 3. ЗАПИСЬ ИСТОРИИ ИЗМЕНЕНИЙ ====================
    const changes: any[] = [];
    
    const finalUserRole = userRole || 'admin';
    const finalUserName = userName || 'Система (авто)';

    const fieldsToTrack = [
      'grade', 'volume', 'delivery_date', 'delivery_time',
      'address', 'phone', 'organization_name', 'full_name',
      'inn', 'comment', 'status', 'is_questionable', 'logistics_ready', 'user_id'
    ];

    const fieldNames: Record<string, string> = {
      grade: 'марку бетона',
      volume: 'объём',
      delivery_date: 'дату доставки',
      delivery_time: 'время доставки',
      address: 'адрес доставки',
      phone: 'телефон',
      organization_name: 'название организации',
      full_name: 'ФИО',
      inn: 'ИНН',
      comment: 'комментарий',
      status: 'статус',
      is_questionable: 'метку "Под вопросом"',
      logistics_ready: 'готовность логистики',
      user_id: 'клиента'
    };

    // Русские названия статусов
    const statusNames: Record<string, string> = {
      new: 'Новая',
      processing: 'В работе',
      completed: 'Выполнена',
      cancelled: 'Отменена'
    };

    for (const field of fieldsToTrack) {
      const oldValue = currentOrder[field];
      const newValue = updateData[field];

      if (newValue === undefined) continue;

      const oldStr = oldValue !== null && oldValue !== undefined ? String(oldValue).trim() : '';
      const newStr = newValue !== null && newValue !== undefined ? String(newValue).trim() : '';

      if (oldStr !== newStr) {
        let actionText = `Изменил ${fieldNames[field] || field}`;

        if (field === 'is_questionable') {
          actionText = newValue ? 'Поставил метку "Под вопросом"' : 'Снял метку "Под вопросом"';
        } 
        else if (field === 'status') {
          const oldStatusName = statusNames[oldStr] || oldStr;
          const newStatusName = statusNames[newStr] || newStr;
          actionText = `Изменил статус заявки с "${oldStatusName}" на "${newStatusName}"`;
        } 
        else if (field === 'volume') {
          actionText = `Изменил объём с ${oldStr} на ${newStr} м³`;
        } 
        else if (field === 'delivery_time') {
          actionText = `Изменил время доставки с ${oldStr} на ${newStr}`;
        } 
        else if (field === 'delivery_date') {
          actionText = `Изменил дату доставки`;
        }

        changes.push({
          order_id: id,
          action: actionText,
          user_name: finalUserName,
          user_role: finalUserRole,
          field_name: field,
          old_value: oldStr || null,
          new_value: newStr || null
        });
      }
    }

    // Сохраняем историю
    if (changes.length > 0) {
      const { error: historyError } = await supabase
        .from('order_history')
        .insert(changes);

      if (historyError) {
        console.error('❌ Ошибка записи истории:', historyError);
      } else {
        console.log(`📜 Записано ${changes.length} изменений в историю`);
      }
    }

    // ==================== 4. ОБНОВЛЕНИЕ ЗАЯВКИ ====================
    const { error: updateError } = await supabase
      .from('orders')
      .update(updateData)
      .eq('id', id);

    if (updateError) {
      console.error('Update error:', updateError);
      return NextResponse.json({ success: false, message: updateError.message }, { status: 500 });
    }

   // console.log(`✅ Заявка #${id} успешно обновлена. Новый статус: ${updateData.status || currentOrder.status}`);

    return NextResponse.json({ 
      success: true, 
      message: 'Заявка успешно обновлена',
      changesCount: changes.length 
    });

  } catch (error: any) {
    console.error('API Error:', error);
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}