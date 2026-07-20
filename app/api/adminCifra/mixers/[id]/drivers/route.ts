import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type Params = Promise<{ id: string }>;

// GET — список дополнительных водителей миксера
export async function GET(_req: NextRequest, { params }: { params: Params }) {
  const { id } = await params;
  const mixerId = Number(id);
  if (!mixerId) return NextResponse.json({ error: 'Invalid mixer id' }, { status: 400 });

  const { data, error } = await supabase
    .from('mixer_drivers')
    .select('id, driver_name, phone, created_at')
    .eq('mixer_id', mixerId)
    .order('created_at', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data || []);
}

// POST — добавить водителя
export async function POST(req: NextRequest, { params }: { params: Params }) {
  const { id } = await params;
  const mixerId = Number(id);
  if (!mixerId) return NextResponse.json({ error: 'Invalid mixer id' }, { status: 400 });

  const { driver_name, phone } = await req.json();
  if (!driver_name?.trim() || !phone?.trim()) {
    return NextResponse.json({ error: 'ФИО и телефон обязательны' }, { status: 400 });
  }

  // Проверяем что такой телефон не задан уже как основной у другого миксера
  const { data: existing } = await supabase
    .from('mixer_drivers')
    .select('id')
    .eq('mixer_id', mixerId)
    .eq('phone', phone.trim())
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ error: 'Этот телефон уже добавлен для данного миксера' }, { status: 409 });
  }

  const { data, error } = await supabase
    .from('mixer_drivers')
    .insert({ mixer_id: mixerId, driver_name: driver_name.trim(), phone: phone.trim() })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, data });
}

// DELETE — удалить водителя по его id
export async function DELETE(req: NextRequest, { params }: { params: Params }) {
  const { id: mixerId } = await params;
  const url = new URL(req.url);
  const driverId = Number(url.searchParams.get('driverId'));

  if (!driverId) return NextResponse.json({ error: 'driverId обязателен' }, { status: 400 });

  const { error } = await supabase
    .from('mixer_drivers')
    .delete()
    .eq('id', driverId)
    .eq('mixer_id', Number(mixerId));

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
