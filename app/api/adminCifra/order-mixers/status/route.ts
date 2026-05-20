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

    const { data, error } = await supabase
      .from('order_mixers')
      .update({ 
        status: status,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .maybeSingle();     // ← Изменено с .single() на .maybeSingle()

    if (error) {
      console.error('Supabase error:', error);
      return NextResponse.json({ success: false, message: error.message }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json({ 
        success: false, 
        message: `Миксер с id ${id} не найден` 
      }, { status: 404 });
    }

    console.log(`✅ Статус миксера ${id} обновлён на: ${status}`);

    return NextResponse.json({ 
      success: true, 
      message: `Статус обновлён на "${status}"`,
      data 
    });

  } catch (error: any) {
    console.error('Update status error:', error);
    return NextResponse.json({ 
      success: false, 
      message: error.message || 'Внутренняя ошибка' 
    }, { status: 500 });
  }
}