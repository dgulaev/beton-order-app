import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(request: NextRequest) {
  try {
    const { id, time } = await request.json();

    console.log(`🔄 Получен запрос на обновление времени: id=${id}, time=${time}`);

    if (!id || time === undefined) {
      return NextResponse.json({ success: false, error: 'Missing id or time' }, { status: 400 });
    }

    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data, error } = await supabase
      .from('order_mixers')
      .update({ 
        time: time,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Supabase update error:', error);
      throw error;
    }

    console.log(`✅ Успешно обновлено в базе:`, data);

    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    console.error('❌ Ошибка обновления времени:', error);
    return NextResponse.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
}