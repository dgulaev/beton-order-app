// app/api/adminCifra/staff/laborant-stats/route.ts
// Статистика лаборанта для карточки в Клиенты → Стафф — в отличие от
// оператора БСУ у лаборанта обычный личный логин (не общая учётка), поэтому
// считаем строго по её/его user_id, без сравнения "кто с кем". Источники —
// готовые таблицы модуля "Лаборатория" (created_by/changed_by уже заполнены
// на каждой записи, миграции для этой статистики не нужны).
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface LaborantPeriodStats {
  tests: { total: number; pass: number; fail: number; pending: number; passRate: number | null };
  passports: { total: number; concrete: number; mortar: number };
  recipeEdits: number;
}

export async function GET(request: NextRequest) {
  try {
    const userId = request.nextUrl.searchParams.get('userId');
    if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 });

    const monthStart = new Date();
    monthStart.setDate(monthStart.getDate() - 30);
    monthStart.setHours(0, 0, 0, 0);
    const sinceIso = monthStart.toISOString();

    const [{ data: tests, error: e1 }, { data: passports, error: e2 }, { data: versions, error: e3 }] = await Promise.all([
      supabase
        .from('concrete_tests')
        .select('result, test_type, created_at')
        .eq('created_by', userId)
        .gte('created_at', sinceIso),
      supabase
        .from('concrete_passports')
        .select('doc_kind, created_at')
        .eq('created_by', userId)
        .gte('created_at', sinceIso),
      supabase
        .from('recipe_versions')
        .select('created_at')
        .eq('changed_by', userId)
        .gte('created_at', sinceIso),
    ]);

    if (e1) throw e1;
    if (e2) throw e2;
    if (e3) throw e3;

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - 7);

    const buildPeriod = (since: Date): LaborantPeriodStats => {
      const periodTests = (tests || []).filter((t) => new Date(t.created_at) >= since);
      const periodPassports = (passports || []).filter((p) => new Date(p.created_at) >= since);
      const periodVersions = (versions || []).filter((v) => new Date(v.created_at) >= since);

      const pass = periodTests.filter((t) => t.result === 'pass').length;
      const fail = periodTests.filter((t) => t.result === 'fail').length;
      const pending = periodTests.filter((t) => !t.result || t.result === 'pending').length;
      const graded = pass + fail;

      return {
        tests: {
          total: periodTests.length,
          pass,
          fail,
          pending,
          passRate: graded > 0 ? Math.round((pass / graded) * 100) : null,
        },
        passports: {
          total: periodPassports.length,
          concrete: periodPassports.filter((p) => p.doc_kind === 'concrete').length,
          mortar: periodPassports.filter((p) => p.doc_kind === 'mortar').length,
        },
        recipeEdits: periodVersions.length,
      };
    };

    return NextResponse.json({
      today: buildPeriod(todayStart),
      week: buildPeriod(weekStart),
      month: buildPeriod(monthStart),
    });
  } catch (error: any) {
    console.error('Laborant stats error:', error);
    return NextResponse.json(
      { error: error.message || 'Не удалось посчитать статистику лаборанта' },
      { status: 500 }
    );
  }
}
