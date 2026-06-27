import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
  try {
    const { client_ids, new_curator_id } = await request.json();

    if (!client_ids || !Array.isArray(client_ids) || client_ids.length === 0) {
      return NextResponse.json({ error: 'client_ids обязателен (массив)' }, { status: 400 });
    }
    if (!new_curator_id) {
      return NextResponse.json({ error: 'new_curator_id обязателен' }, { status: 400 });
    }

    // Получаем имя куратора
    const { data: curator } = await supabase
      .from('users')
      .select('full_name')
      .eq('user_id', new_curator_id)
      .single();

    const updateData = {
      curator_id: new_curator_id,
      curator_name: curator?.full_name || null,
      created_by: new_curator_id,        // синхронизация
      updated_at: new Date().toISOString()
    };

    console.log(`🔄 Обновляем ${client_ids.length} клиентов:`, client_ids);

    const { error, count } = await supabase
      .from('users')
      .update(updateData)
      .in('user_id', client_ids);

    if (error) {
      console.error('Update curator error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    console.log(`✅ Успешно обновлено ${count} клиентов. Куратор: ${new_curator_id}`);

    return NextResponse.json({ 
      success: true, 
      updated: count,
      message: `Куратор назначен ${count} клиентам`
    });

  } catch (error: any) {
    console.error('Update curator API error:', error);
    return NextResponse.json({ error: error.message || 'Внутренняя ошибка' }, { status: 500 });
  }
}