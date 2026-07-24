// Списания цемента за день (по cement_write_off_at) — для сверки MEKA.
// Склад в сверке = списания рейсов + компенсации MEKA (если применена).
// Разбивка по силосам учитывает сегменты order_mixer_cement_segments.
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getMekaCementCompensation } from '@/lib/mekaCementCompensate';
import { SILO_SPEC, siloNameById } from '@/lib/siloConfig';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function moscowDayBounds(dateKey: string): { start: string; end: string } {
  const start = new Date(`${dateKey}T00:00:00+03:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

export async function GET(request: NextRequest) {
  try {
    const dateIso = request.nextUrl.searchParams.get('date');
    if (!dateIso || !/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) {
      return NextResponse.json({ error: 'Нужен date=YYYY-MM-DD' }, { status: 400 });
    }

    const { start, end } = moscowDayBounds(dateIso);

    const { data, error } = await supabase
      .from('order_mixers')
      .select('id, cement_write_off_silo_id, cement_write_off_kg, cement_write_off_at')
      .not('cement_write_off_kg', 'is', null)
      .gte('cement_write_off_at', start)
      .lt('cement_write_off_at', end);

    if (error) throw error;

    const bySiloMap = new Map<number, number>();
    for (const spec of SILO_SPEC) bySiloMap.set(spec.silo_id, 0);

    const mixerIds = (data || [])
      .map((row) => Number(row.id))
      .filter((id) => Number.isFinite(id) && id > 0);

    const segmentsByMixer = new Map<number, { silo_id: number; cement_kg: number }[]>();
    if (mixerIds.length > 0) {
      const { data: segRows, error: segError } = await supabase
        .from('order_mixer_cement_segments')
        .select('order_mixer_id, silo_id, cement_kg')
        .in('order_mixer_id', mixerIds);
      if (!segError && segRows) {
        for (const row of segRows) {
          const mid = Number(row.order_mixer_id);
          const list = segmentsByMixer.get(mid) || [];
          list.push({
            silo_id: Number(row.silo_id),
            cement_kg: Number(row.cement_kg),
          });
          segmentsByMixer.set(mid, list);
        }
      }
    }

    let tripsKg = 0;
    for (const row of data || []) {
      const kg = Math.round(Number(row.cement_write_off_kg || 0) * 10) / 10;
      if (!(kg > 0)) continue;
      tripsKg += kg;

      const mid = Number(row.id);
      const segments = segmentsByMixer.get(mid) || [];
      if (segments.length > 0) {
        let segSum = 0;
        for (const seg of segments) {
          const segKg = Math.round(Number(seg.cement_kg || 0) * 10) / 10;
          if (!(segKg > 0) || !bySiloMap.has(seg.silo_id)) continue;
          bySiloMap.set(seg.silo_id, (bySiloMap.get(seg.silo_id) || 0) + segKg);
          segSum += segKg;
        }
        // Хвост округления / рассинхрон — на legacy-силос рейса
        const tail = Math.round((kg - segSum) * 10) / 10;
        if (Math.abs(tail) >= 0.05) {
          const legacySilo = Number(row.cement_write_off_silo_id);
          if (bySiloMap.has(legacySilo)) {
            bySiloMap.set(legacySilo, (bySiloMap.get(legacySilo) || 0) + tail);
          }
        }
      } else {
        const siloId = Number(row.cement_write_off_silo_id);
        if (bySiloMap.has(siloId)) {
          bySiloMap.set(siloId, (bySiloMap.get(siloId) || 0) + kg);
        }
      }
    }
    tripsKg = Math.round(tripsKg * 10) / 10;

    const compensation = await getMekaCementCompensation(dateIso);
    let compensationAdjKg = 0;
    if (compensation?.status === 'applied') {
      for (const row of compensation.bySilo) {
        const signed = row.direction === 'writeoff' ? row.kg : -row.kg;
        compensationAdjKg += signed;
        if (bySiloMap.has(row.siloId)) {
          bySiloMap.set(row.siloId, (bySiloMap.get(row.siloId) || 0) + signed);
        }
      }
      compensationAdjKg = Math.round(compensationAdjKg * 10) / 10;
    }

    const totalKg = Math.round((tripsKg + compensationAdjKg) * 10) / 10;

    return NextResponse.json({
      date: dateIso,
      tripsKg,
      totalKg,
      bySilo: SILO_SPEC.map((s) => ({
        siloId: s.silo_id,
        name: siloNameById(s.silo_id),
        kg: Math.round((bySiloMap.get(s.silo_id) || 0) * 10) / 10,
      })),
      compensation: compensation
        ? {
            status: compensation.status,
            mekaKg: compensation.mekaKg,
            warehouseKg: compensation.warehouseKg,
            deltaKg: compensation.deltaKg,
            bySilo: compensation.bySilo,
            createdAt: compensation.createdAt,
          }
        : null,
    });
  } catch (err: any) {
    console.error('cement-day GET:', err);
    return NextResponse.json({ error: err.message || 'Ошибка' }, { status: 500 });
  }
}
