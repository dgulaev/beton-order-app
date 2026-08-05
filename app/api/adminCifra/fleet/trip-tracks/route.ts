import { NextRequest, NextResponse } from 'next/server';
import { requireAdminCifraStaff } from '@/lib/adminCifraAuth';
import { buildTripRoutesForMixerDay } from '@/lib/fleetTripTracks';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

/** СКАУТ + OSRM + геокод — на Hobby/Pro нужно больше дефолтных 10–15 с. */
export const maxDuration = 60;

/** GET ?mixer_id=&day=YYYY-MM-DD — маршруты рейсов за день (завод → объект). */
export async function GET(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request);
  if (auth.error) return auth.error;

  const mixerId = Number(request.nextUrl.searchParams.get('mixer_id'));
  const day = request.nextUrl.searchParams.get('day');

  if (!Number.isFinite(mixerId) || mixerId <= 0) {
    return NextResponse.json({ success: false, error: 'mixer_id обязателен' }, { status: 400 });
  }
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return NextResponse.json({ success: false, error: 'day=YYYY-MM-DD обязателен' }, { status: 400 });
  }

  const { data: mixer, error: mixErr } = await supabaseAdmin
    .from('mixers')
    .select('id, number, scout_unit_id')
    .eq('id', mixerId)
    .maybeSingle();

  if (mixErr) {
    return NextResponse.json({ success: false, error: mixErr.message }, { status: 500 });
  }
  if (!mixer) {
    return NextResponse.json({ success: false, error: 'ТС не найдено' }, { status: 404 });
  }

  try {
    const result = await buildTripRoutesForMixerDay({
      mixerId: mixer.id,
      mixerNumber: String(mixer.number),
      scoutUnitId: mixer.scout_unit_id != null ? Number(mixer.scout_unit_id) : null,
      day,
    });

    return NextResponse.json({
      success: true,
      mixerId: mixer.id,
      number: mixer.number,
      day,
      ...result,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[fleet trip-tracks]', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
