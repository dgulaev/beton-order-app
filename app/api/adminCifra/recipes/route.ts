import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sanitizeRecipePayload } from '@/app/adminCifra/recipes/productCatalog';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// GET — получить рецепты.
// По умолчанию (без параметров) отдаёт только активные — это поведение,
// на которое рассчитывает форма создания заказа менеджера (NewOrderModal).
// Каталог «Лаборатории» передаёт ?all=true, чтобы видеть и неактивные.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const includeAll = searchParams.get('all') === 'true';

  let query = supabase.from('recipes').select('*').order('code');
  if (!includeAll) {
    query = query.eq('is_active', true);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

// POST — создать новый рецепт
export async function POST(request: NextRequest) {
  const body = await request.json();
  const sanitized = sanitizeRecipePayload(body);
  if (!sanitized.ok) {
    return NextResponse.json({ error: sanitized.error }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('recipes')
    .insert([sanitized.data])
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

// PUT — обновить рецепт (legacy; основной путь — /recipes/[id])
export async function PUT(request: NextRequest) {
  const body = await request.json();
  const { id, change_note: _cn, changed_by: _cb, changed_by_name: _cbn, ...rest } = body;
  if (!id) {
    return NextResponse.json({ error: 'ID required' }, { status: 400 });
  }

  const { data: current, error: loadErr } = await supabase
    .from('recipes')
    .select('*')
    .eq('id', id)
    .single();

  if (loadErr || !current) {
    return NextResponse.json({ error: loadErr?.message || 'Рецепт не найден' }, { status: 404 });
  }

  const sanitized = sanitizeRecipePayload({ ...current, ...rest });
  if (!sanitized.ok) {
    return NextResponse.json({ error: sanitized.error }, { status: 400 });
  }

  const { id: _id, created_at: _ca, updated_at: _ua, ...updateData } = sanitized.data;

  const { data, error } = await supabase
    .from('recipes')
    .update(updateData)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

// DELETE — удалить рецепт
export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return NextResponse.json({ error: 'ID required' }, { status: 400 });
  }

  const { error } = await supabase
    .from('recipes')
    .delete()
    .eq('id', id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
