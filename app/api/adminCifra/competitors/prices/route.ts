import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { ADMIN_CIFRA_STAFF_ROLES, requireAdminCifraStaff } from '@/lib/adminCifraAuth';
import {
  COMPETITOR_MATRIX_GRADES,
  recipeToMatrixCell,
  type CompetitorFiller,
  type MatrixColumn,
} from '@/lib/competitors';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const FILLERS = new Set(['granite', 'dolomite', 'mortar']);

async function loadMatrixColumns(): Promise<MatrixColumn[]> {
  const { data, error } = await supabase
    .from('competitor_matrix_columns')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('id', { ascending: true });

  if (error || !data?.length) {
    return COMPETITOR_MATRIX_GRADES.map((c, i) => ({
      ...c,
      id: i + 1,
      sort_order: (i + 1) * 10,
    }));
  }

  return data.map((r) => ({
    id: r.id,
    grade_key: r.grade_key,
    filler: r.filler as CompetitorFiller,
    label: r.label,
    ourCode: r.our_code,
    sort_order: r.sort_order,
  }));
}

/** GET — последние цены по каждому competitor×grade×filler (+ наши из recipes). */
export async function GET(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request, ADMIN_CIFRA_STAFF_ROLES);
  if (auth.error) return auth.error;

  try {
    const columns = await loadMatrixColumns();

    const { data: snaps, error } = await supabase
      .from('competitor_price_snapshots')
      .select('*')
      .order('parsed_at', { ascending: false })
      .limit(5000);

    if (error) {
      if (/competitor_price/i.test(error.message)) {
        return NextResponse.json({ snapshots: [], ours: {}, oursByCode: {}, columns });
      }
      throw error;
    }

    // Последний снапшот на ключ
    const latest = new Map<string, any>();
    for (const s of snaps || []) {
      const key = `${s.competitor_id}|${s.grade_key}|${s.filler}`;
      if (!latest.has(key)) latest.set(key, s);
    }

    // Бетон / раствор из нашей продукции (фильтр item_type на сервере + в коде)
    const { data: recipes } = await supabase
      .from('recipes')
      .select('code, price, type, item_type, name, is_active');

    /** Ключ матрицы: `${grade_key}|${filler}` → цена ТрейдКом */
    const ours: Record<string, number> = {};
    /** По нашему code (М300 / М300и / ТР М100) */
    const oursByCode: Record<string, number> = {};

    const concreteRecipes = (recipes || []).filter((r) => {
      if (r.is_active === false) return false;
      const itemType = String(r.item_type || '');
      return itemType !== 'aggregate' && itemType !== 'cement' && itemType !== 'fbs';
    });

    for (const r of concreteRecipes) {
      const cell = recipeToMatrixCell(r);
      if (!cell) continue;

      const matrixKey = `${cell.grade_key}|${cell.filler}`;
      if (ours[matrixKey] == null) ours[matrixKey] = cell.price;

      const code = String(r.code || '').trim();
      if (code) oursByCode[code] = cell.price;
    }

    // Добиваем по явным ourCode из матрицы (М100и / ТР М100 с пробелом)
    for (const col of columns) {
      const matrixKey = `${col.grade_key}|${col.filler}`;
      if (ours[matrixKey] != null) continue;
      const want = col.ourCode.toLowerCase().replace(/\s+/g, '');
      const hit = concreteRecipes.find((r) => {
        const a = String(r.code || '').trim().toLowerCase().replace(/\s+/g, '');
        return a === want;
      });
      if (hit && Number(hit.price) > 0) {
        ours[matrixKey] = Number(hit.price);
        oursByCode[col.ourCode] = Number(hit.price);
      }
    }

    return NextResponse.json({
      snapshots: Array.from(latest.values()),
      ours,
      oursByCode,
      columns,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

/** POST — ручной ввод / импорт цены. */
export async function POST(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request, ['admin']);
  if (auth.error) return auth.error;

  try {
    const body = await request.json();
    const {
      competitor_id,
      grade_key,
      filler = 'granite',
      price,
      source_url,
      source_kind = 'manual',
      notes,
    } = body;

    if (!competitor_id || !grade_key) {
      return NextResponse.json({ error: 'competitor_id и grade_key обязательны' }, { status: 400 });
    }
    if (!FILLERS.has(filler)) {
      return NextResponse.json({ error: 'Некорректный filler' }, { status: 400 });
    }

    let priceVal: number | null = null;
    if (price !== '' && price != null) {
      priceVal = Number(price);
      if (!Number.isFinite(priceVal) || priceVal < 0 || priceVal > 100000) {
        return NextResponse.json(
          { error: 'Цена: число от 0 до 100000 ₽, либо пусто' },
          { status: 400 },
        );
      }
    }

    const { data, error } = await supabase
      .from('competitor_price_snapshots')
      .insert([
        {
          competitor_id: Number(competitor_id),
          grade_key: String(grade_key).trim(),
          filler,
          price: priceVal,
          source_url: source_url || null,
          source_kind,
          notes: notes || null,
          parsed_at: new Date().toISOString(),
        },
      ])
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ success: true, data });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
