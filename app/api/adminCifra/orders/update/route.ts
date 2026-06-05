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

    // ==================== 1. ПРОВЕРКА ВХОДНЫХ ДАННЫХ ====================
    if (!id) {
      return NextResponse.json({ success: false, message: 'ID заявки обязателен' }, { status: 400 });
    }

    console.log('🔄 [Update API] Получена роль от фронта:', userRole);

    // ==================== 2. ПОЛУЧЕНИЕ ТЕКУЩЕЙ ЗАЯВКИ ====================
    const { data: currentOrder, error: fetchError } = await supabase
      .from('orders')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !currentOrder) {
      return NextResponse.json({ success: false, message: 'Заявка не найдена' }, { status: 404 });
    }

    // ==================== 3. ЗАПИСЬ ИСТОРИИ ИЗМЕНЕНИЙ ====================
    const changes: any[] = [];
    
    const finalUserRole = userRole || 'unknown';
    const userName = body.userName || finalUserRole || 'Администратор';

    const fieldsToTrack = [
      'grade', 'volume', 'delivery_date', 'delivery_time',
      'address', 'phone', 'organization_name', 'full_name',
      'inn', 'comment', 'status', 'is_questionable'   // ← Добавлено!
    ];

    console.log(`🔄 Сравнение полей. Роль: ${finalUserRole} | Имя: ${userName}`);

    for (const field of fieldsToTrack) {
      const oldValue = currentOrder[field];
      const newValue = updateData[field];

      if (newValue === undefined) continue;

      const oldStr = oldValue !== null && oldValue !== undefined ? String(oldValue).trim() : '';
      const newStr = newValue !== null && newValue !== undefined ? String(newValue).trim() : '';

      if (oldStr !== newStr) {
        const actionText = `Изменено поле ${field}`;

        console.log(`📝 ${actionText}: "${oldStr}" → "${newStr}"`);

        changes.push({
          order_id: id,
          action: actionText,
          user_name: userName,
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
        console.log(`✅ Успешно записано ${changes.length} изменений от роли: ${finalUserRole}`);
      }
    }

    // ==================== 4. ОБНОВЛЕНИЕ ЗАЯВКИ ====================
    const { error: updateError } = await supabase
      .from('orders')
      .update(updateData)                    // ← Теперь обновляем всё, что пришло
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