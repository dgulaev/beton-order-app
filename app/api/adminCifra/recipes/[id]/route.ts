// app/api/adminCifra/recipes/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// PUT — обновить рецепт по ID
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    const { data, error } = await supabase
      .from('recipes')
      .update(body)
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