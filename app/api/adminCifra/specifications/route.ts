// app/api/adminCifra/specifications/route.ts
// CRUD спецификаций + фильтры каталога (Активные / Без рецептов / Без продуктов).
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const filter = searchParams.get('filter'); // active / no_recipes / no_products
  const search = (searchParams.get('search') || '').trim().toLowerCase();

  // Тянем назначенные рецептуры через встроенную связь по FK spec_id.
  const { data, error } = await supabase
    .from('specifications')
    .select('*, specification_recipes(id, plant_id, recipe_id)')
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let list = (data || []) as any[];

  if (filter === 'active') {
    list = list.filter((s) => s.status === 'active');
  } else if (filter === 'no_recipes') {
    // Считаем «без рецепта» и строки со связью, но без выбранного recipe_id.
    list = list.filter((s) => {
      const links = s.specification_recipes || [];
      return links.length === 0 || links.every((l: any) => !l.recipe_id);
    });
  } else if (filter === 'no_products') {
    list = list.filter((s) => !s.product_name || String(s.product_name).trim() === '');
  }

  if (search) {
    list = list.filter((s) =>
      [s.code, s.name, s.grade, s.product_name]
        .filter(Boolean)
        .some((v: string) => String(v).toLowerCase().includes(search))
    );
  }

  return NextResponse.json(list);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  // Назначенные рецептуры передаются отдельным массивом recipe_links.
  const { recipe_links, ...spec } = body;

  const { data, error } = await supabase.from('specifications').insert([spec]).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (Array.isArray(recipe_links) && recipe_links.length > 0 && data?.id) {
    const rows = recipe_links.map((l: any) => ({
      spec_id: data.id,
      plant_id: l.plant_id ?? null,
      recipe_id: l.recipe_id ?? null,
    }));
    await supabase.from('specification_recipes').insert(rows);
  }

  return NextResponse.json(data);
}

export async function PUT(request: NextRequest) {
  const body = await request.json();
  const { id, recipe_links, ...updateData } = body;
  updateData.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from('specifications')
    .update(updateData)
    .eq('id', id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Если пришёл новый набор рецептур — пересобираем связи.
  if (Array.isArray(recipe_links)) {
    await supabase.from('specification_recipes').delete().eq('spec_id', id);
    if (recipe_links.length > 0) {
      const rows = recipe_links.map((l: any) => ({
        spec_id: id,
        plant_id: l.plant_id ?? null,
        recipe_id: l.recipe_id ?? null,
      }));
      await supabase.from('specification_recipes').insert(rows);
    }
  }

  return NextResponse.json(data);
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'ID required' }, { status: 400 });
  const { error } = await supabase.from('specifications').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
