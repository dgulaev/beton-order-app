import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
  try {
    const { pfmLiters = 0, linomixLiters = 0 } = await request.json();

   // console.log(`🔄 [SUBTRACT] Запрос: ПФМ-НЛК = ${pfmLiters} л, Линомикс = ${linomixLiters} л`);

    // ПФМ-НЛК (additive_id = 1)
    if (pfmLiters > 0) {
      // Сначала получаем текущее значение
      const { data: currentData } = await supabase
        .from('warehouse_additives')
        .select('current')
        .eq('additive_id', 1)
        .single();

      const newCurrent = Math.max(0, (currentData?.current || 0) - pfmLiters);

      const { error } = await supabase
        .from('warehouse_additives')
        .update({ 
          current: newCurrent,
          updated_at: new Date().toISOString()
        })
        .eq('additive_id', 1);

      if (error) console.error('❌ Ошибка ПФМ-НЛК:', error);
      else console.log(`✅ ПФМ-НЛК списано. Новое значение: ${newCurrent} л`);
    }

    // Линомикс (additive_id = 2)
    if (linomixLiters > 0) {
      const { data: currentData } = await supabase
        .from('warehouse_additives')
        .select('current')
        .eq('additive_id', 2)
        .single();

      const newCurrent = Math.max(0, (currentData?.current || 0) - linomixLiters);

      const { error } = await supabase
        .from('warehouse_additives')
        .update({ 
          current: newCurrent,
          updated_at: new Date().toISOString()
        })
        .eq('additive_id', 2);

      if (error) console.error('❌ Ошибка Линомикс:', error);
      else console.log(`✅ Линомикс списано. Новое значение: ${newCurrent} л`);
    }

    return NextResponse.json({ success: true });

  } catch (error: any) {
    console.error('💥 Ошибка в subtract route:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}