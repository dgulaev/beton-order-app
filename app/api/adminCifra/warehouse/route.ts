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

    // === ФБС — устойчивая версия к двойным вызовам ===
if (fbs && Array.isArray(fbs)) {
  for (const b of fbs) {
    const blockName = String(b.name || b.code || '').trim();
    const blockCode = String(b.code || b.name || '').trim();

    if (!blockName) continue;

    console.log(`🔍 Обработка ФБС: "${blockName}" (code: ${blockCode}) → ${b.current} шт`);

    // Проверяем существование
    const { data: existing } = await supabase
      .from('fbs_blocks')
      .select('id, current')
      .eq('name', blockName)
      .maybeSingle();

    if (existing) {
      // Обновляем
      await supabase
        .from('fbs_blocks')
        .update({ 
          current: Number(b.current || 0),
          updated_at: new Date().toISOString() 
        })
        .eq('name', blockName);
      
      console.log(`✅ Обновлено: "${blockName}" → ${b.current} шт`);
    } else {
      // Создаём только если точно нет
      const { data, error } = await supabase
        .from('fbs_blocks')
        .insert({
          name: blockName,
          code: blockCode,
          unit: 'шт',
          price: 0,
          is_active: true,
          current: Number(b.current || 0),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .select()
        .single();

      if (error) {
        if (error.code === '23505') { // duplicate key
          console.log(`⚠️ Тип "${blockName}" уже существует (дубликат вызова)`);
        } else {
          console.error(`❌ Ошибка создания "${blockName}":`, error);
        }
      } else {
        console.log(`✅ Создан новый тип: "${blockName}" (id=${data.id}) → ${b.current} шт`);
      }
    }
  }
}

    return NextResponse.json({ success: true, message: 'Склад сохранён' });
  } catch (error: any) {
    console.error('💥 Ошибка POST склада:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}