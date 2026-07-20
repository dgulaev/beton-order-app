// app/api/adminCifra/mixers/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// GET — получение всех миксеров вместе с доп. водителями
export async function GET() {
  try {
    const { data, error } = await supabase
      .from('mixers')
      .select('*, mixer_drivers(id, driver_name, phone)')
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
    const { id, number, model, driver, phone, volume, type, status, unload_allowance_min } = body;

    if (!number || !driver) {
      return NextResponse.json({ error: 'Номер и водитель обязательны' }, { status: 400 });
    }

    if (!phone || !String(phone).trim()) {
      return NextResponse.json({ error: 'Телефон водителя обязателен — по нему водитель входит в мобильное приложение' }, { status: 400 });
    }

    // Норма простоя из БД имеет смысл только для наёмных миксеров — для своих
    // используется фиксированная константа 50 мин из кода (см. lib/orderMixers.ts).
    if (type === 'rented' && (unload_allowance_min === undefined || unload_allowance_min === null || unload_allowance_min === '')) {
      return NextResponse.json({ error: 'Для наёмного миксера укажите норму разгрузки в минутах' }, { status: 400 });
    }
    const normalizedAllowance = type === 'rented' ? Number(unload_allowance_min) : null;
    if (type === 'rented' && (!Number.isFinite(normalizedAllowance) || normalizedAllowance! <= 0)) {
      return NextResponse.json({ error: 'Норма разгрузки для наёмного миксера должна быть больше 0' }, { status: 400 });
    }

    if (id) {
      // Обновление существующего
      const { data, error } = await supabase
        .from('mixers')
        .update({ number, model, driver, phone, volume, type, status, unload_allowance_min: normalizedAllowance, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return NextResponse.json({ success: true, data });
    } else {
      // Создание нового
      const { data, error } = await supabase
        .from('mixers')
        .insert([{ number, model, driver, phone, volume, type, status, unload_allowance_min: normalizedAllowance }])
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