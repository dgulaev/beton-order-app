import { NextRequest, NextResponse } from 'next/server';
import { FLEET_MUTATION_ROLES, requireAdminCifraStaff } from '@/lib/adminCifraAuth';
import { fleetTableMissingMessage } from '@/lib/fleetDocumentsServer';
import { isServiceKind } from '@/lib/fleetService';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

/** GET — графики ТО (?mixer_id= или без — все) */
export async function GET(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request);
  if (auth.error) return auth.error;

  const mixerIdRaw = request.nextUrl.searchParams.get('mixer_id');
  let query = supabaseAdmin
    .from('fleet_service_schedules')
    .select('*')
    .order('created_at', { ascending: false });

  if (mixerIdRaw) {
    const mixerId = Number(mixerIdRaw);
    if (!Number.isFinite(mixerId) || mixerId <= 0) {
      return NextResponse.json({ success: false, error: 'mixer_id некорректен' }, { status: 400 });
    }
    query = query.eq('mixer_id', mixerId);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json(
      {
        success: false,
        error: fleetTableMissingMessage(error.message, 'fleet_service_schedules'),
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true, schedules: data ?? [] });
}

/** POST — создать шаблон ТО */
export async function POST(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request, FLEET_MUTATION_ROLES);
  if (auth.error) return auth.error;

  try {
    const body = await request.json();
    const mixerId = Number(body.mixer_id);
    const serviceKind = String(body.service_kind || '');
    if (!Number.isFinite(mixerId) || mixerId <= 0) {
      return NextResponse.json({ success: false, error: 'mixer_id обязателен' }, { status: 400 });
    }
    if (!isServiceKind(serviceKind)) {
      return NextResponse.json({ success: false, error: 'Некорректный вид работ' }, { status: 400 });
    }

    const row = {
      mixer_id: mixerId,
      service_kind: serviceKind,
      title: body.title ? String(body.title).trim() : null,
      interval_km: body.interval_km != null && body.interval_km !== '' ? Number(body.interval_km) : null,
      interval_days:
        body.interval_days != null && body.interval_days !== ''
          ? Math.round(Number(body.interval_days))
          : null,
      interval_hours:
        body.interval_hours != null && body.interval_hours !== ''
          ? Number(body.interval_hours)
          : null,
      last_done_at: body.last_done_at || null,
      last_odometer:
        body.last_odometer != null && body.last_odometer !== ''
          ? Number(body.last_odometer)
          : null,
      last_engine_hours:
        body.last_engine_hours != null && body.last_engine_hours !== ''
          ? Number(body.last_engine_hours)
          : null,
    };

    if (
      row.interval_km == null &&
      row.interval_days == null &&
      row.interval_hours == null
    ) {
      return NextResponse.json(
        { success: false, error: 'Укажите интервал: км, дни или моточасы' },
        { status: 400 },
      );
    }

    const { data, error } = await supabaseAdmin
      .from('fleet_service_schedules')
      .insert(row)
      .select('*')
      .single();

    if (error) {
      return NextResponse.json(
        {
          success: false,
          error: fleetTableMissingMessage(error.message, 'fleet_service_schedules'),
        },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true, schedule: data });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'Ошибка' },
      { status: 500 },
    );
  }
}

/** PATCH — обновить шаблон */
export async function PATCH(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request, FLEET_MUTATION_ROLES);
  if (auth.error) return auth.error;

  try {
    const body = await request.json();
    const id = Number(body.id);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ success: false, error: 'id обязателен' }, { status: 400 });
    }

    const patch: Record<string, unknown> = {};
    if (body.service_kind != null) {
      if (!isServiceKind(body.service_kind)) {
        return NextResponse.json({ success: false, error: 'Некорректный вид работ' }, { status: 400 });
      }
      patch.service_kind = body.service_kind;
    }
    if (body.title !== undefined) patch.title = body.title ? String(body.title).trim() : null;
    if (body.interval_km !== undefined) {
      patch.interval_km = body.interval_km === '' || body.interval_km == null ? null : Number(body.interval_km);
    }
    if (body.interval_days !== undefined) {
      patch.interval_days =
        body.interval_days === '' || body.interval_days == null
          ? null
          : Math.round(Number(body.interval_days));
    }
    if (body.interval_hours !== undefined) {
      patch.interval_hours =
        body.interval_hours === '' || body.interval_hours == null
          ? null
          : Number(body.interval_hours);
    }
    if (body.last_done_at !== undefined) patch.last_done_at = body.last_done_at || null;
    if (body.last_odometer !== undefined) {
      patch.last_odometer =
        body.last_odometer === '' || body.last_odometer == null
          ? null
          : Number(body.last_odometer);
    }
    if (body.last_engine_hours !== undefined) {
      patch.last_engine_hours =
        body.last_engine_hours === '' || body.last_engine_hours == null
          ? null
          : Number(body.last_engine_hours);
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ success: false, error: 'Нечего обновлять' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('fleet_service_schedules')
      .update(patch)
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      return NextResponse.json(
        {
          success: false,
          error: fleetTableMissingMessage(error.message, 'fleet_service_schedules'),
        },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true, schedule: data });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'Ошибка' },
      { status: 500 },
    );
  }
}

/** DELETE — ?id= */
export async function DELETE(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request, FLEET_MUTATION_ROLES);
  if (auth.error) return auth.error;

  const id = Number(request.nextUrl.searchParams.get('id'));
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ success: false, error: 'id обязателен' }, { status: 400 });
  }

  const { error } = await supabaseAdmin.from('fleet_service_schedules').delete().eq('id', id);
  if (error) {
    return NextResponse.json(
      {
        success: false,
        error: fleetTableMissingMessage(error.message, 'fleet_service_schedules'),
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true });
}
