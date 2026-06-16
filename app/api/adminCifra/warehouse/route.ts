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
    const { silos, additives, fbs } = await request.json();

    console.log('📥 Получено additives:', JSON.stringify(additives, null, 2));

    // Силосы
    if (silos && Array.isArray(silos)) {
      for (const s of silos) {
        await supabase
          .from('warehouse_silos')
          .update({ 
            current: Number(s.current), 
            updated_at: new Date().toISOString() 
          })
          .eq('silo_id', Number(s.silo_id));
      }
    }

    // === ДОБАВКИ — ИСПРАВЛЕНИЕ ===
    if (additives && Array.isArray(additives)) {
      for (const a of additives) {
        const updateData: any = {
          current: Number(a.current || 0),
          updated_at: new Date().toISOString()
        };

        // Добавляем обновление max, если оно пришло
        if (a.max !== undefined) {
          updateData.max = Number(a.max);
        }

        await supabase
          .from('warehouse_additives')
          .update(updateData)
          .eq('additive_id', Number(a.additive_id));
      }
    }

    // ФБС (оставляем как было)
    if (fbs && Array.isArray(fbs)) {
      for (const b of fbs) {
        const blockName = b.name?.trim();

        const { data: existing } = await supabase
          .from('fbs_blocks')
          .select('id, name, current')
          .eq('name', blockName)
          .single();

        if (!existing) {
          console.error(`❌ Не найдена запись с name = "${blockName}"`);
          continue;
        }

        await supabase
          .from('fbs_blocks')
          .update({ 
            current: Number(b.current),
            updated_at: new Date().toISOString() 
          })
          .eq('name', blockName);
      }
    }

    return NextResponse.json({ success: true, message: 'Склад сохранён' });
  } catch (error: any) {
    console.error('💥 Ошибка POST склада:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}