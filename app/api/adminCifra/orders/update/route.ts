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
    const { id, userRole, ...updateData } = body;

    if (!id) {
      return NextResponse.json({ success: false, message: 'ID заявки обязателен' }, { status: 400 });
    }

    // Получаем текущую версию заявки
    const { data: currentOrder, error: fetchError } = await supabase
      .from('orders')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !currentOrder) {
      return NextResponse.json({ success: false, message: 'Заявка не найдена' }, { status: 404 });
    }

                // ==================== ЗАПИСЬ ИСТОРИИ ИЗМЕНЕНИЙ ====================
    const changes: any[] = [];
    const changedBy = userRole || 'admin';

    const fieldsToTrack = [
      'grade', 'volume', 'delivery_date', 'delivery_time',
      'address', 'phone', 'organization_name', 'full_name',
      'inn', 'comment', 'status'
    ];

    console.log('🔄 Сравнение полей. Изменения от:', changedBy);

    for (const field of fieldsToTrack) {
      const oldValue = currentOrder[field];
      const newValue = updateData[field];

      // Улучшенное сравнение: пропускаем, если новое значение undefined или такое же
      if (newValue === undefined) continue;

      const oldStr = oldValue !== null && oldValue !== undefined ? String(oldValue).trim() : '';
      const newStr = newValue !== null && newValue !== undefined ? String(newValue).trim() : '';

      if (oldStr !== newStr) {
        const actionText = `Изменено поле ${field}`;

        console.log(`📝 ${actionText}: "${oldStr}" → "${newStr}"`);

        changes.push({
          order_id: id,
          action: actionText,
          user_name: changedBy,
          user_role: changedBy,
          field_name: field,
          old_value: oldStr || null,
          new_value: newStr || null
        });
      }
    }

    // Сохраняем историю изменений
    if (changes.length > 0) {
      const { error: historyError } = await supabase
        .from('order_history')
        .insert(changes);

      if (historyError) {
        console.error('❌ Ошибка записи истории:', historyError);
      } else {
        console.log(`✅ Успешно записано ${changes.length} изменений в историю`);
      }
    } else {
      console.log('⚠️ Нет реальных изменений для записи');
    }

    // ==================== ОБНОВЛЕНИЕ ЗАЯВКИ ====================
    const { error: updateError } = await supabase
      .from('orders')
      .update({
        grade: updateData.grade,
        volume: updateData.volume,
        delivery_date: updateData.delivery_date,
        delivery_time: updateData.delivery_time,
        address: updateData.address,
        phone: updateData.phone,
        organization_name: updateData.organization_name,
        full_name: updateData.full_name,
        inn: updateData.inn,
        comment: updateData.comment,
        status: updateData.status,           // ← Добавили!
      })
      .eq('id', id);

    if (updateError) {
      console.error('Update error:', updateError);
      return NextResponse.json({ success: false, message: updateError.message }, { status: 500 });
    }

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