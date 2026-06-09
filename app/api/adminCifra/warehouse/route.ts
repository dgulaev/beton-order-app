import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  try {
    const [silosRes, additivesRes] = await Promise.all([
      supabase.from('warehouse_silos').select('*').order('silo_id'),
      supabase.from('warehouse_additives').select('*').order('additive_id')
    ]);

    return NextResponse.json({
      silos: silosRes.data || [],
      additives: additivesRes.data || []
    });
  } catch (error) {
    console.error('Ошибка GET склада:', error);
    return NextResponse.json({ error: 'Ошибка загрузки' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { silos, additives } = await request.json();

    // Обновление силосов
    if (silos && Array.isArray(silos)) {
      for (const s of silos) {
        await supabase
          .from('warehouse_silos')
          .update({ current: Number(s.current), updated_at: new Date().toISOString() })
          .eq('silo_id', Number(s.silo_id));
      }
    }

    // Обновление добавок — точно как силосы
    if (additives && Array.isArray(additives)) {
      for (const a of additives) {
        await supabase
          .from('warehouse_additives')
          .update({ 
            current: Number(a.current),
            updated_at: new Date().toISOString() 
          })
          .eq('additive_id', Number(a.additive_id));
      }
    }

    return NextResponse.json({ success: true, message: 'Склад сохранён' });
  } catch (error) {
    console.error('Ошибка POST склада:', error);
    return NextResponse.json({ error: 'Ошибка сохранения' }, { status: 500 });
  }
}