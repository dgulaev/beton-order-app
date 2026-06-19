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

    console.log('🔄 [Update API] Обновление заявки #', id, 'от', userName || 'Система');

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

    if (finalStatuses.includes(currentOrder.status) && updateData.status !== undefined) {
      delete updateData.status;
      console.log('⚠️ Попытка изменить статус финальной заявки — отклонено');
    }

    // ==================== 3. ЗАПИСЬ ИСТОРИИ ИЗМЕНЕНИЙ ====================
    const changes: any[] = [];
    
    const finalUserRole = userRole || 'admin';
    const finalUserName = userName || 'Система (авто)';

    const fieldsToTrack = [
      'grade', 'volume', 'delivery_date', 'delivery_time',
      'address', 'phone', 'organization_name', 'full_name',
      'inn', 'comment', 'status', 'is_questionable', 'logistics_ready'
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
      logistics_ready: 'готовность логистики'
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
        } else if (field === 'status') {
          actionText = `Изменил статус заявки на "${newStr}"`;
        } else if (field === 'volume') {
          actionText = `Изменил объём с ${oldStr} на ${newStr} м³`;
        } else if (field === 'delivery_time') {
          actionText = `Изменил время доставки с ${oldStr} на ${newStr}`;
        } else if (field === 'delivery_date') {
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

    console.log(`✅ Заявка #${id} успешно обновлена. Новый статус: ${updateData.status || currentOrder.status}`);

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