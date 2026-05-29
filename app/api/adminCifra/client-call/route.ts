// app/api/adminCifra/client-call/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
  try {
    const { client_id, result, comment } = await request.json();

    console.log('📞 [Client Call] Получен результат:', { client_id, result, comment });

    if (!client_id || !result) {
      return NextResponse.json({ error: 'client_id и result обязательны' }, { status: 400 });
    }

    const { error } = await supabase
      .from('client_calls')
      .insert({
        client_id: client_id,
        manager_id: null,        // ← Используем вашу колонку
        result: result,
        comment: comment || null
      });

    if (error) {
      console.error('❌ Supabase error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    console.log('✅ Результат звонка успешно сохранён');
    return NextResponse.json({ success: true, message: 'Результат звонка сохранён' });

  } catch (err: any) {
    console.error('❌ Ошибка в client-call API:', err);
    return NextResponse.json({ error: err.message || 'Внутренняя ошибка' }, { status: 500 });
  }
}