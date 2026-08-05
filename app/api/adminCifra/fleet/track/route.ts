import { NextRequest, NextResponse } from 'next/server';
import { requireAdminCifraStaff } from '@/lib/adminCifraAuth';
import { scoutFetchNavigationTrack } from '@/lib/integrations/scout';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const maxDuration = 60;

export type FleetTrackPoint = {
  lat: number;
  lon: number;
  speedKmh: number | null;
  recordedAt: string;
};

function parseDayBounds(fromParam: string | null, toParam: string | null): {
  fromIso: string;
  toIso: string;
} | null {
  // YYYY-MM-DD — день по Europe/Moscow (±3)
  const today = new Date();
  const fmt = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };
  const fromDay = fromParam && /^\d{4}-\d{2}-\d{2}$/.test(fromParam) ? fromParam : fmt(today);
  const toDay = toParam && /^\d{4}-\d{2}-\d{2}$/.test(toParam) ? toParam : fromDay;
  // Локальная полуночь МСК ≈ UTC+3 зимой/летом без tz-db: используем явный offset +03:00
  const fromIso = `${fromDay}T00:00:00+03:00`;
  const toIso = `${toDay}T23:59:59+03:00`;
  if (new Date(fromIso).getTime() > new Date(toIso).getTime()) return null;
  return { fromIso, toIso };
}

async function loadLocalTrail(
  mixerId: number,
  fromIso: string,
  toIso: string,
): Promise<FleetTrackPoint[]> {
  const { data, error } = await supabaseAdmin
    .from('fleet_telemetry_points')
    .select('lat, lon, speed_kmh, recorded_at')
    .eq('mixer_id', mixerId)
    .gte('recorded_at', fromIso)
    .lte('recorded_at', toIso)
    .order('recorded_at', { ascending: true })
    .limit(5000);

  if (error) {
    if (/fleet_telemetry_points/i.test(error.message)) {
      throw new Error('Выполните scripts/fleet-telemetry-points.sql');
    }
    throw error;
  }

  return (data ?? []).map((row) => ({
    lat: Number(row.lat),
    lon: Number(row.lon),
    speedKmh: row.speed_kmh != null ? Number(row.speed_kmh) : null,
    recordedAt: String(row.recorded_at),
  }));
}

/**
 * GET ?mixer_id=&from=YYYY-MM-DD&to=YYYY-MM-DD&source=auto|scout|local
 * auto: сначала СКАУТ NavigationFiltration, при пусто/ошибке — локальный trail
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request);
  if (auth.error) return auth.error;

  const mixerId = Number(request.nextUrl.searchParams.get('mixer_id'));
  if (!Number.isFinite(mixerId) || mixerId <= 0) {
    return NextResponse.json({ success: false, error: 'mixer_id обязателен' }, { status: 400 });
  }

  const bounds = parseDayBounds(
    request.nextUrl.searchParams.get('from'),
    request.nextUrl.searchParams.get('to'),
  );
  if (!bounds) {
    return NextResponse.json({ success: false, error: 'Некорректный период from/to' }, { status: 400 });
  }

  const sourceParam = (request.nextUrl.searchParams.get('source') || 'auto').toLowerCase();
  const source = sourceParam === 'scout' || sourceParam === 'local' ? sourceParam : 'auto';

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

  let points: FleetTrackPoint[] = [];
  let usedSource: 'scout' | 'local' | 'none' = 'none';
  let scoutError: string | null = null;

  const tryScout = source === 'auto' || source === 'scout';
  const tryLocal = source === 'auto' || source === 'local';

  if (tryScout && mixer.scout_unit_id != null) {
    try {
      const scoutPts = await scoutFetchNavigationTrack({
        unitId: Number(mixer.scout_unit_id),
        fromIso: bounds.fromIso,
        toIso: bounds.toIso,
      });
      points = scoutPts.map((p) => ({
        lat: p.lat,
        lon: p.lon,
        speedKmh: p.speedKmh,
        recordedAt: p.recordedAt,
      }));
      if (points.length) usedSource = 'scout';
    } catch (e) {
      scoutError = e instanceof Error ? e.message : String(e);
      if (source === 'scout') {
        return NextResponse.json(
          { success: false, error: scoutError, from: bounds.fromIso, to: bounds.toIso },
          { status: 502 },
        );
      }
    }
  }

  if ((!points.length || usedSource === 'none') && tryLocal) {
    try {
      points = await loadLocalTrail(mixerId, bounds.fromIso, bounds.toIso);
      if (points.length) usedSource = 'local';
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return NextResponse.json({ success: false, error: message }, { status: 500 });
    }
  }

  return NextResponse.json({
    success: true,
    mixerId,
    number: mixer.number,
    scoutUnitId: mixer.scout_unit_id,
    from: bounds.fromIso,
    to: bounds.toIso,
    source: usedSource,
    scoutError,
    pointCount: points.length,
    points,
  });
}
