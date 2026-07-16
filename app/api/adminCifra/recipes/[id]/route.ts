// app/api/adminCifra/recipes/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// PUT — обновить рецепт по ID.
// Перед изменением пишем снимок текущего состояния в recipe_versions
// (история «кто/когда/что менял»). Запись версии обёрнута в try/catch —
// если таблицы ещё нет или запись не удалась, сохранение рецепта не ломается.
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    // Метаданные истории не относятся к колонкам recipes — отделяем их.
    const { change_note, changed_by, changed_by_name, ...updateData } = body;

    // Снимок текущего состояния ДО изменения — для истории версий.
    try {
      const { data: current } = await supabase
        .from('recipes')
        .select('*')
        .eq('id', id)
        .single();

      if (current) {
        const { count } = await supabase
          .from('recipe_versions')
          .select('*', { count: 'exact', head: true })
          .eq('recipe_id', Number(id));

        await supabase.from('recipe_versions').insert({
          recipe_id: Number(id),
          version_no: (count || 0) + 1,
          snapshot: current,
          changed_by: changed_by ?? null,
          changed_by_name: changed_by_name ?? null,
          change_note: change_note ?? null,
        });
      }
    } catch (versionErr) {
      console.warn('recipe_versions write skipped:', versionErr);
    }

    const { data, error } = await supabase
      .from('recipes')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Update recipe error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (e: any) {
    console.error('PUT recipe error:', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
