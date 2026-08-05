// Сцепки голова (tractor_unit) ↔ прицеп (cement_truck | tonar).
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdminCifraStaff, WAREHOUSE_MUTATION_ROLES } from '@/lib/adminCifraAuth';
import {
  formatCoupleLabel,
  isTrailerKind,
  isVehicleKind,
  type VehicleKind,
} from '@/lib/fleetCatalog';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const COUPLE_ROLES = [
  ...WAREHOUSE_MUTATION_ROLES.filter((r) => r !== 'operator'),
  'mehanik',
] as const;

type MixerRow = {
  id: number;
  number: string;
  model: string | null;
  driver: string | null;
  phone: string | null;
  volume: number | null;
  vehicle_kind: string | null;
  type: string | null;
  status: string | null;
};

function tableMissing(msg: string) {
  return /fleet_couples|does not exist|relation/i.test(msg);
}

/** GET — активные сцепки; ?trailer_kind=cement_truck|tonar; ?assignable=1 — + моноблоки без сцепки. */
export async function GET(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request);
  if (auth.error) return auth.error;

  const trailerKindParam = request.nextUrl.searchParams.get('trailer_kind');
  const assignable = request.nextUrl.searchParams.get('assignable') === '1';
  /** Фильтр вида прицепа/техники для assignable (в т.ч. dump_truck). */
  const trailerKindFilter =
    trailerKindParam && isVehicleKind(trailerKindParam) ? trailerKindParam : null;
  const coupleTrailerKind =
    trailerKindFilter && isTrailerKind(trailerKindFilter) ? trailerKindFilter : null;

  try {
    const { data: couples, error } = await supabase
      .from('fleet_couples')
      .select('id, tractor_id, trailer_id, active, coupled_at, coupled_by')
      .eq('active', true)
      .order('coupled_at', { ascending: false });

    if (error) {
      if (tableMissing(error.message || '')) {
        return NextResponse.json(
          assignable
            ? { couples: [], monoblocks: [], assignable: [] }
            : { couples: [] },
        );
      }
      throw error;
    }

    const rows = couples || [];
    const tractorIds = [...new Set(rows.map((c) => c.tractor_id))];
    const trailerIds = [...new Set(rows.map((c) => c.trailer_id))];
    const allIds = [...new Set([...tractorIds, ...trailerIds])];

    let mixersById = new Map<number, MixerRow>();
    if (allIds.length > 0) {
      const { data: mixers } = await supabase
        .from('mixers')
        .select('id, number, model, driver, phone, volume, vehicle_kind, type, status')
        .in('id', allIds);
      for (const m of mixers || []) mixersById.set(Number(m.id), m as MixerRow);
    }

    const formattedCouples = rows
      .map((c) => {
        const tractor = mixersById.get(Number(c.tractor_id));
        const trailer = mixersById.get(Number(c.trailer_id));
        if (!tractor || !trailer) return null;
        if (coupleTrailerKind && trailer.vehicle_kind !== coupleTrailerKind) return null;
        const label = formatCoupleLabel({
          tractorModel: tractor.model,
          tractorNumber: tractor.number,
          trailerKind: trailer.vehicle_kind,
          trailerVolume: Number(trailer.volume || 0),
          trailerNumber: trailer.number,
        });
        return {
          id: c.id,
          couple_id: c.id,
          tractor_id: c.tractor_id,
          trailer_id: c.trailer_id,
          coupled_at: c.coupled_at,
          coupled_by: c.coupled_by,
          label,
          number: tractor.number,
          volume: Number(trailer.volume || 0),
          model: tractor.model,
          driver: tractor.driver,
          phone: tractor.phone,
          trailer_kind: trailer.vehicle_kind,
          trailer_number: trailer.number,
          tractor,
          trailer,
          type: 'couple' as const,
        };
      })
      .filter(Boolean);

    if (!assignable) {
      return NextResponse.json({ couples: formattedCouples });
    }

    // Моноблоки: прицепы/самосвалы без активной сцепки (старый «цементовоз целиком»)
    const kinds: VehicleKind[] = trailerKindFilter
      ? [trailerKindFilter]
      : ['cement_truck', 'tonar', 'dump_truck'];
    const coupledTrailerIds = new Set(rows.map((c) => Number(c.trailer_id)));

    // Для dump_truck сцепок нет — только моноблоки; для бочек/тоннаров
    // моноблок = техника без активной сцепки (старые «цементовоз целиком»).
    const { data: fleet } = await supabase
      .from('mixers')
      .select('id, number, model, driver, phone, volume, vehicle_kind, type, status')
      .in('vehicle_kind', kinds);

    // Моноблок = старая «машина целиком» (есть водитель). Чистый прицеп без
    // сцепки и без водителя в назначение не отдаём — только через голову.
    const monoblocks = (fleet || [])
      .filter((m) => {
        if (!Boolean(String(m.driver || '').trim())) return false;
        if (m.vehicle_kind === 'dump_truck') return true;
        return !coupledTrailerIds.has(Number(m.id));
      })
      .map((m) => {
        const kind = String(m.vehicle_kind || '');
        const vol = Number(m.volume || 0);
        const unit = kind === 'cement_truck' || kind === 'tonar' ? 'т' : 'м³';
        const label = `${m.number} — ${m.model || '—'} (${vol} ${unit})${m.driver ? ` · ${m.driver}` : ''} · моноблок`;
        return {
          type: 'monoblock' as const,
          id: m.id,
          trailer_id: m.id,
          tractor_id: null,
          couple_id: null,
          number: m.number,
          volume: vol,
          model: m.model,
          driver: m.driver,
          phone: m.phone,
          trailer_kind: kind,
          label,
        };
      });

    // Для dump_truck / non-trailer сцепок нет — иначе в самосвальную заявку
    // утекут все бочки/тоннары. Без фильтра — все сцепки (как раньше).
    const couplesForAssign =
      trailerKindFilter && !isTrailerKind(trailerKindFilter)
        ? []
        : formattedCouples.filter((c) => Boolean(String(c!.driver || '').trim()));

    const assignableList = [
      ...couplesForAssign.map((c) => ({
        ...c!,
        value: `couple:${c!.couple_id}`,
      })),
      ...monoblocks.map((m) => ({
        ...m,
        value: `mono:${m.id}`,
      })),
    ];

    return NextResponse.json({
      couples: formattedCouples,
      monoblocks,
      assignable: assignableList,
    });
  } catch (e: any) {
    console.error('fleet-couples GET:', e);
    return NextResponse.json({ error: e.message || 'Ошибка' }, { status: 500 });
  }
}

/** POST — сцепить / перецепить { tractor_id, trailer_id }. */
export async function POST(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request, COUPLE_ROLES);
  if (auth.error) return auth.error;

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Некорректный JSON' }, { status: 400 });
  }

  const tractorId = Number(body.tractor_id);
  const trailerId = Number(body.trailer_id);
  if (!Number.isFinite(tractorId) || !Number.isFinite(trailerId)) {
    return NextResponse.json({ error: 'Укажите tractor_id и trailer_id' }, { status: 400 });
  }
  if (tractorId === trailerId) {
    return NextResponse.json({ error: 'Голова и прицеп должны быть разными' }, { status: 400 });
  }

  const { data: units, error: uErr } = await supabase
    .from('mixers')
    .select('id, number, model, vehicle_kind, volume')
    .in('id', [tractorId, trailerId]);

  if (uErr) {
    if (tableMissing(uErr.message || '')) {
      return NextResponse.json(
        { error: 'Выполни scripts/fleet-couples.sql в Supabase' },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: uErr.message }, { status: 500 });
  }

  const tractor = (units || []).find((u) => Number(u.id) === tractorId);
  const trailer = (units || []).find((u) => Number(u.id) === trailerId);
  if (!tractor || !trailer) {
    return NextResponse.json({ error: 'Голова или прицеп не найдены' }, { status: 404 });
  }
  if (tractor.vehicle_kind !== 'tractor_unit') {
    return NextResponse.json({ error: 'Первая единица должна быть головой (tractor_unit)' }, { status: 400 });
  }
  if (!isTrailerKind(trailer.vehicle_kind)) {
    return NextResponse.json(
      { error: 'Прицеп должен быть тоннаром или цементовозом (бочкой)' },
      { status: 400 },
    );
  }

  const who =
    auth.user.full_name ||
    String(body.coupled_by || '') ||
    `user:${auth.user.user_id}`;

  // Закрыть активные сцепки головы и прицепа
  const now = new Date().toISOString();
  const { error: closeErr } = await supabase
    .from('fleet_couples')
    .update({ active: false, uncoupled_at: now })
    .eq('active', true)
    .or(`tractor_id.eq.${tractorId},trailer_id.eq.${trailerId}`);

  if (closeErr) {
    if (tableMissing(closeErr.message || '')) {
      return NextResponse.json(
        { error: 'Выполни scripts/fleet-couples.sql в Supabase' },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: closeErr.message }, { status: 500 });
  }

  const { data: created, error: insErr } = await supabase
    .from('fleet_couples')
    .insert({
      tractor_id: tractorId,
      trailer_id: trailerId,
      active: true,
      coupled_by: who,
      coupled_at: now,
    })
    .select()
    .single();

  if (insErr) {
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  const label = formatCoupleLabel({
    tractorModel: tractor.model,
    tractorNumber: tractor.number,
    trailerKind: trailer.vehicle_kind,
    trailerVolume: Number(trailer.volume || 0),
    trailerNumber: trailer.number,
  });

  return NextResponse.json({ success: true, data: created, label });
}

/** DELETE — отцепить ?id=coupleId или ?trailer_id= / ?tractor_id= */
export async function DELETE(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request, COUPLE_ROLES);
  if (auth.error) return auth.error;

  const id = Number(request.nextUrl.searchParams.get('id') || 0);
  const trailerId = Number(request.nextUrl.searchParams.get('trailer_id') || 0);
  const tractorId = Number(request.nextUrl.searchParams.get('tractor_id') || 0);

  let query = supabase
    .from('fleet_couples')
    .update({ active: false, uncoupled_at: new Date().toISOString() })
    .eq('active', true);

  if (Number.isFinite(id) && id > 0) {
    query = query.eq('id', id);
  } else if (Number.isFinite(trailerId) && trailerId > 0) {
    query = query.eq('trailer_id', trailerId);
  } else if (Number.isFinite(tractorId) && tractorId > 0) {
    query = query.eq('tractor_id', tractorId);
  } else {
    return NextResponse.json({ error: 'Укажите id, trailer_id или tractor_id' }, { status: 400 });
  }

  const { data, error } = await query.select();
  if (error) {
    if (tableMissing(error.message || '')) {
      return NextResponse.json(
        { error: 'Выполни scripts/fleet-couples.sql в Supabase' },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, closed: data?.length || 0 });
}
