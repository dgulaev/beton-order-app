import { NextRequest, NextResponse } from 'next/server';
import { requireAdminCifraStaff } from '@/lib/adminCifraAuth';
import { fleetTableMissingMessage } from '@/lib/fleetDocumentsServer';
import {
  computeServiceDue,
  type FleetServiceSchedule,
  type ServiceDueInfo,
} from '@/lib/fleetService';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

/**
 * GET — сводка «скоро ТО» по парку.
 * ?mixer_ids=1,2,3 — опционально; иначе все schedules + одометры.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request);
  if (auth.error) return auth.error;

  const idsRaw = request.nextUrl.searchParams.get('mixer_ids');
  let mixerIds: number[] | null = null;
  if (idsRaw) {
    mixerIds = idsRaw
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0);
  }

  let schedQuery = supabaseAdmin.from('fleet_service_schedules').select('*');
  if (mixerIds?.length) schedQuery = schedQuery.in('mixer_id', mixerIds);

  const { data: schedules, error: schedErr } = await schedQuery;
  if (schedErr) {
    return NextResponse.json(
      {
        success: false,
        error: fleetTableMissingMessage(schedErr.message, 'fleet_service_schedules'),
      },
      { status: 500 },
    );
  }

  const ids = [
    ...new Set((schedules ?? []).map((s) => Number(s.mixer_id)).filter(Boolean)),
  ];
  if (ids.length === 0) {
    return NextResponse.json({ success: true, due: [], byMixer: {} });
  }

  const { data: mixers } = await supabaseAdmin
    .from('mixers')
    .select('id, odometer_km, engine_hours')
    .in('id', ids);

  const odoMap = new Map<number, { odometer_km: number | null; engine_hours: number | null }>();
  for (const m of mixers ?? []) {
    odoMap.set(Number(m.id), {
      odometer_km: m.odometer_km != null ? Number(m.odometer_km) : null,
      engine_hours: m.engine_hours != null ? Number(m.engine_hours) : null,
    });
  }

  const due: Array<ServiceDueInfo & { mixer_id: number }> = [];
  const byMixer: Record<number, ServiceDueInfo[]> = {};

  for (const raw of schedules ?? []) {
    const s = raw as FleetServiceSchedule;
    const odo = odoMap.get(Number(s.mixer_id));
    const info = computeServiceDue(
      s,
      odo?.odometer_km,
      odo?.engine_hours,
    );
    if (!info || info.urgency === 'ok') continue;
    const item = { ...info, mixer_id: Number(s.mixer_id) };
    due.push(item);
    if (!byMixer[item.mixer_id]) byMixer[item.mixer_id] = [];
    byMixer[item.mixer_id].push(info);
  }

  due.sort((a, b) => {
    const rank = (u: string) => (u === 'overdue' ? 0 : 1);
    return rank(a.urgency) - rank(b.urgency);
  });

  return NextResponse.json({ success: true, due, byMixer });
}
