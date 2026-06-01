import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// GET — загрузить состояние склада
export async function GET() {
  try {
    const [silosRes, additivesRes] = await Promise.all([
      supabase.from('warehouse_silos').select('*').order('silo_id'),
      supabase.from('warehouse_additives').select('*').order('additive_id')
    ]);

    console.log('📦 Загружено силосов:', silosRes.data?.length);
    console.log('📦 Загружено добавок:', additivesRes.data?.length);

    return NextResponse.json({
      silos: silosRes.data || [],
      additives: additivesRes.data || []
    });
  } catch (error) {
    console.error('Ошибка GET склада:', error);
    return NextResponse.json({ error: 'Ошибка загрузки склада' }, { status: 500 });
  }
}

// POST — сохранить изменения
export async function POST(request: NextRequest) {
  try {
    const { silos } = await request.json();

    if (silos && Array.isArray(silos)) {
      for (const silo of silos) {
        const { error } = await supabase
          .from('warehouse_silos')
          .update({ 
            current: Number(silo.current),
            updated_at: new Date().toISOString()
          })
          .eq('silo_id', Number(silo.silo_id));

        if (error) {
          console.error(`Ошибка обновления силоса ${silo.silo_id}:`, error);
        } else {
          console.log(`✅ Силос ${silo.silo_id} обновлён на ${silo.current}`);
        }
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Ошибка POST склада:', error);
    return NextResponse.json({ error: 'Ошибка сохранения' }, { status: 500 });
  }
}