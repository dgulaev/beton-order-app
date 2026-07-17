// app/api/adminCifra/warehouse/reconcile/route.ts
// Сверка «план по отчёту MEKA» vs «факт, уже списанный в реальном времени»
// за конкретную дату. Раньше загрузка отчёта MEKA сама списывала добавки со
// склада (см. историю в /api/adminCifra/warehouse/subtract) — теперь склад
// меняется только в момент разгрузки конкретного рейса (lib/orderMixers.ts),
// а отчёт MEKA используется просто для сверки: не потерялся ли рейс, не
// разошлись ли цифры с тем, что реально списалось.
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/supabaseAdmin';

export async function GET(request: NextRequest) {
  try {
    const dateParam = request.nextUrl.searchParams.get('date');
    if (!dateParam) {
      return NextResponse.json({ error: 'Параметр date обязателен (YYYY-MM-DD)' }, { status: 400 });
    }

    const dayStart = new Date(`${dateParam}T00:00:00`);
    const dayEnd = new Date(`${dateParam}T23:59:59.999`);

    if (isNaN(dayStart.getTime())) {
      return NextResponse.json({ error: 'Некорректная дата' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('order_mixers')
      .select('additive_write_off_id, additive_write_off_liters, additive_write_off_kg, unloaded_at')
      .not('additive_write_off_liters', 'is', null)
      .gte('unloaded_at', dayStart.toISOString())
      .lte('unloaded_at', dayEnd.toISOString());

    if (error) throw error;

    let pfmKg = 0;
    let pfmLiters = 0;
    let linomixKg = 0;
    let linomixLiters = 0;

    (data || []).forEach((row: any) => {
      const liters = Number(row.additive_write_off_liters || 0);
      const kg = Number(row.additive_write_off_kg || 0);
      if (Number(row.additive_write_off_id) === 1) {
        pfmLiters += liters;
        pfmKg += kg;
      } else if (Number(row.additive_write_off_id) === 2) {
        linomixLiters += liters;
        linomixKg += kg;
      }
    });

    return NextResponse.json({
      date: dateParam,
      actual: {
        pfmKg: Math.round(pfmKg * 10) / 10,
        pfmLiters: Math.round(pfmLiters * 10) / 10,
        linomixKg: Math.round(linomixKg * 10) / 10,
        linomixLiters: Math.round(linomixLiters * 10) / 10,
      },
      trips: (data || []).length,
    });
  } catch (error: any) {
    console.error('Warehouse reconcile error:', error);
    return NextResponse.json({ error: error.message || 'Не удалось посчитать сверку' }, { status: 500 });
  }
}
