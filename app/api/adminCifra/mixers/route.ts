// app/api/adminCifra/mixers/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// GET — получение всех миксеров
export async function GET() {
  try {
    const { data, error } = await supabase
      .from('mixers')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    return NextResponse.json(data || []);
  } catch (error: any) {
    console.error('Mixers GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST — добавление / обновление миксера
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, number, model, driver, phone, volume, type, status } = body;

    if (!number || !driver) {
      return NextResponse.json({ error: 'Номер и водитель обязательны' }, { status: 400 });
    }

    if (id) {
      // Обновление существующего
      const { data, error } = await supabase
        .from('mixers')
        .update({ number, model, driver, phone, volume, type, status, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return NextResponse.json({ success: true, data });
    } else {
      // Создание нового
      const { data, error } = await supabase
        .from('mixers')
        .insert([{ number, model, driver, phone, volume, type, status }])
        .select()
        .single();

      if (error) throw error;
      return NextResponse.json({ success: true, data });
    }
  } catch (error: any) {
    console.error('Mixers POST error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}