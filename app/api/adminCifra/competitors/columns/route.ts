import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { ADMIN_CIFRA_STAFF_ROLES, requireAdminCifraStaff } from '@/lib/adminCifraAuth';
import {
  COMPETITOR_MATRIX_GRADES,
  matrixColumnFromParts,
  normalizeGradeKeyInput,
  type CompetitorFiller,
} from '@/lib/competitors';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const FILLERS = new Set(['granite', 'dolomite', 'mortar']);

function mapRow(r: any) {
  return {
    id: r.id,
    grade_key: r.grade_key,
    filler: r.filler as CompetitorFiller,
    label: r.label,
    ourCode: r.our_code,
    sort_order: r.sort_order,
  };
}

/** true = таблица есть; false = таблицы нет (fallback на константы). */
async function ensureSeeded(): Promise<boolean> {
  const { count, error } = await supabase
    .from('competitor_matrix_columns')
    .select('id', { count: 'exact', head: true });
  if (error) {
    if (/competitor_matrix_columns/i.test(error.message)) return false;
    throw error;
  }
  if ((count || 0) > 0) return true;

  const rows = COMPETITOR_MATRIX_GRADES.map((c, i) => ({
    grade_key: c.grade_key,
    filler: c.filler,
    label: c.label,
    our_code: c.ourCode,
    sort_order: (i + 1) * 10,
  }));
  const { error: insErr } = await supabase.from('competitor_matrix_columns').insert(rows);
  if (insErr && /competitor_matrix_columns/i.test(insErr.message)) return false;
  if (insErr) throw insErr;
  return true;
}

function fallbackColumns() {
  return COMPETITOR_MATRIX_GRADES.map((c, i) => ({ ...c, id: i + 1, sort_order: (i + 1) * 10 }));
}

export async function GET(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request, ADMIN_CIFRA_STAFF_ROLES);
  if (auth.error) return auth.error;

  try {
    const ok = await ensureSeeded();
    if (!ok) return NextResponse.json(fallbackColumns());

    const { data, error } = await supabase
      .from('competitor_matrix_columns')
      .select('*')
      .order('sort_order', { ascending: true })
      .order('id', { ascending: true });

    if (error) {
      if (/competitor_matrix_columns/i.test(error.message)) {
        return NextResponse.json(fallbackColumns());
      }
      throw error;
    }
    return NextResponse.json((data || []).map(mapRow));
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request, ['admin']);
  if (auth.error) return auth.error;

  try {
    const ok = await ensureSeeded();
    if (!ok) {
      return NextResponse.json(
        { error: 'Выполните scripts/competitors.sql — таблица колонок ещё не создана' },
        { status: 503 },
      );
    }
    const body = await request.json();
    const { id, filler, grade, grade_key: rawKey, label, our_code, ourCode, sort_order } = body;

    if (!FILLERS.has(filler)) {
      return NextResponse.json({ error: 'Тип: granite | dolomite | mortar' }, { status: 400 });
    }

    const grade_key = normalizeGradeKeyInput(rawKey || grade || '');
    if (!grade_key) {
      return NextResponse.json({ error: 'Укажите марку, например М300 или 300' }, { status: 400 });
    }

    const built = matrixColumnFromParts(grade_key, filler as CompetitorFiller);
    const payload = {
      grade_key: built.grade_key,
      filler: built.filler,
      label: (label && String(label).trim()) || built.label,
      our_code: (our_code || ourCode || built.ourCode).trim(),
      sort_order:
        sort_order != null && sort_order !== ''
          ? Number(sort_order)
          : filler === 'granite'
            ? 50
            : filler === 'dolomite'
              ? 150
              : 250,
    };

    if (id) {
      const { data, error } = await supabase
        .from('competitor_matrix_columns')
        .update(payload)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return NextResponse.json({ success: true, data: mapRow(data) });
    }

    const { data, error } = await supabase
      .from('competitor_matrix_columns')
      .insert([payload])
      .select()
      .single();
    if (error) {
      if (/unique|duplicate/i.test(error.message)) {
        return NextResponse.json({ error: 'Такая марка уже есть в матрице' }, { status: 409 });
      }
      if (/competitor_matrix_columns/i.test(error.message)) {
        return NextResponse.json(
          { error: 'Выполните scripts/competitors.sql — таблица колонок ещё не создана' },
          { status: 503 }
        );
      }
      throw error;
    }
    return NextResponse.json({ success: true, data: mapRow(data) });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request, ['admin']);
  if (auth.error) return auth.error;

  try {
    const id = Number(request.nextUrl.searchParams.get('id'));
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: 'id обязателен' }, { status: 400 });
    }
    const { error } = await supabase.from('competitor_matrix_columns').delete().eq('id', id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
