// Списания цемента за день (по cement_write_off_at) — для сверки MEKA.
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { SILO_SPEC, siloNameById } from '@/lib/siloConfig';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: NextRequest) {
  try {
    const dateIso = request.nextUrl.searchParams.get('date');
    if (!dateIso || !/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) {
      return NextResponse.json({ error: 'Нужен date=YYYY-MM-DD' }, { status: 400 });
    }

    const from = `${dateIso}T00:00:00`;
    const to = `${dateIso}T23:59:59.999`;

    const { data, error } = await supabase
      .from('order_mixers')
      .select('cement_write_off_silo_id, cement_write_off_kg, cement_write_off_at')
      .not('cement_write_off_kg', 'is', null)
      .gte('cement_write_off_at', from)
      .lte('cement_write_off_at', to);

    if (error) throw error;

    const bySiloMap = new Map<number, number>();
    for (const spec of SILO_SPEC) bySiloMap.set(spec.silo_id, 0);

    let totalKg = 0;
    for (const row of data || []) {
      const kg = Number(row.cement_write_off_kg || 0);
      const siloId = Number(row.cement_write_off_silo_id);
      totalKg += kg;
      if (bySiloMap.has(siloId)) {
        bySiloMap.set(siloId, (bySiloMap.get(siloId) || 0) + kg);
      }
    }

    return NextResponse.json({
      date: dateIso,
      totalKg: Math.round(totalKg * 10) / 10,
      bySilo: SILO_SPEC.map((s) => ({
        siloId: s.silo_id,
        name: siloNameById(s.silo_id),
        kg: Math.round((bySiloMap.get(s.silo_id) || 0) * 10) / 10,
      })),
    });
  } catch (err: any) {
    console.error('cement-day GET:', err);
    return NextResponse.json({ error: err.message || 'Ошибка' }, { status: 500 });
  }
}
