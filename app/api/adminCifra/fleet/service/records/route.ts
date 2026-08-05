import { NextRequest, NextResponse } from 'next/server';
import { FLEET_MUTATION_ROLES, requireAdminCifraStaff } from '@/lib/adminCifraAuth';
import {
  createFleetDocumentSignedUrl,
  fleetTableMissingMessage,
} from '@/lib/fleetDocumentsServer';
import {
  isServiceRecordStatus,
  normalizeServiceRecord,
  parseParts,
  parsePhotos,
  todayMoscowYmd,
  type FleetServiceRecord,
  type ServiceRecordStatus,
} from '@/lib/fleetService';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

async function syncScheduleAfterDone(opts: {
  scheduleId: number | null;
  serviceDate: string;
  odometerKm: number | null;
}) {
  if (!opts.scheduleId) return;
  const patch: Record<string, unknown> = {
    last_done_at: `${opts.serviceDate}T12:00:00.000Z`,
  };
  if (opts.odometerKm != null && Number.isFinite(opts.odometerKm)) {
    patch.last_odometer = opts.odometerKm;
  }

  const { data: schedule } = await supabaseAdmin
    .from('fleet_service_schedules')
    .select('mixer_id')
    .eq('id', opts.scheduleId)
    .maybeSingle();
  if (schedule?.mixer_id) {
    const { data: mixer } = await supabaseAdmin
      .from('mixers')
      .select('engine_hours')
      .eq('id', schedule.mixer_id)
      .maybeSingle();
    if (mixer?.engine_hours != null) {
      patch.last_engine_hours = Number(mixer.engine_hours);
    }
  }

  await supabaseAdmin
    .from('fleet_service_schedules')
    .update(patch)
    .eq('id', opts.scheduleId);
}

/** Если нет открытых заявок — снять «На ремонте» (только repair → active). */
async function restoreLifecycleIfNoOpenRequests(mixerId: number) {
  const { data: open } = await supabaseAdmin
    .from('fleet_service_records')
    .select('id')
    .eq('mixer_id', mixerId)
    .in('status', ['requested', 'in_progress'])
    .limit(1);
  if (open?.length) return;
  await supabaseAdmin
    .from('mixers')
    .update({ lifecycle_status: 'active' })
    .eq('id', mixerId)
    .eq('lifecycle_status', 'repair');
}

async function setLifecycleRepair(mixerId: number) {
  await supabaseAdmin
    .from('mixers')
    .update({ lifecycle_status: 'repair' })
    .eq('id', mixerId);
}

async function withPhotoUrls(record: FleetServiceRecord): Promise<FleetServiceRecord> {
  if (!record.photos.length) return { ...record, photoUrls: [] };
  const photoUrls: string[] = [];
  for (const path of record.photos) {
    try {
      photoUrls.push(await createFleetDocumentSignedUrl(path, 3600));
    } catch {
      /* skip broken path */
    }
  }
  return { ...record, photoUrls };
}

/** GET — записи (?mixer_id= обязателен, ?status= опционально) */
export async function GET(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request);
  if (auth.error) return auth.error;

  const mixerId = Number(request.nextUrl.searchParams.get('mixer_id'));
  if (!Number.isFinite(mixerId) || mixerId <= 0) {
    return NextResponse.json({ success: false, error: 'mixer_id обязателен' }, { status: 400 });
  }

  let query = supabaseAdmin
    .from('fleet_service_records')
    .select('*')
    .eq('mixer_id', mixerId)
    .order('service_date', { ascending: false })
    .order('created_at', { ascending: false });

  const status = request.nextUrl.searchParams.get('status');
  if (status && isServiceRecordStatus(status)) {
    query = query.eq('status', status);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json(
      {
        success: false,
        error: fleetTableMissingMessage(error.message, 'fleet_service_records'),
      },
      { status: 500 },
    );
  }

  const records = await Promise.all(
    (data ?? []).map((row) =>
      withPhotoUrls(normalizeServiceRecord(row as Record<string, unknown>)),
    ),
  );
  return NextResponse.json({ success: true, records });
}

/** POST — создать запись (в т.ч. заявку на ремонт) */
export async function POST(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request, FLEET_MUTATION_ROLES);
  if (auth.error) return auth.error;

  try {
    const body = await request.json();
    const mixerId = Number(body.mixer_id);
    if (!Number.isFinite(mixerId) || mixerId <= 0) {
      return NextResponse.json({ success: false, error: 'mixer_id обязателен' }, { status: 400 });
    }

    const status: ServiceRecordStatus = isServiceRecordStatus(body.status)
      ? body.status
      : 'done';
    const serviceDate = String(body.service_date || todayMoscowYmd()).slice(0, 10);
    const odometerKm =
      body.odometer_km != null && body.odometer_km !== '' && Number.isFinite(Number(body.odometer_km))
        ? Number(body.odometer_km)
        : null;
    let scheduleId: number | null =
      body.schedule_id != null && body.schedule_id !== '' ? Number(body.schedule_id) : null;
    if (scheduleId != null && !Number.isFinite(scheduleId)) scheduleId = null;

    // schedule должен принадлежать этому ТС
    if (scheduleId != null) {
      const { data: sched } = await supabaseAdmin
        .from('fleet_service_schedules')
        .select('id')
        .eq('id', scheduleId)
        .eq('mixer_id', mixerId)
        .maybeSingle();
      if (!sched) {
        return NextResponse.json(
          { success: false, error: 'Шаблон ТО не найден у этой машины' },
          { status: 400 },
        );
      }
    }

    const row = {
      mixer_id: mixerId,
      schedule_id: scheduleId,
      status,
      service_date: serviceDate,
      odometer_km: odometerKm,
      description: body.description ? String(body.description).trim() : null,
      parts: parseParts(body.parts),
      labor_cost: Number(body.labor_cost) || 0,
      parts_cost: Number(body.parts_cost) || 0,
      performed_by: body.performed_by ? String(body.performed_by).trim() : null,
      photos: parsePhotos(body.photos),
      created_by: auth.user.full_name || 'Сотрудник',
    };

    const { data, error } = await supabaseAdmin
      .from('fleet_service_records')
      .insert(row)
      .select('*')
      .single();

    if (error) {
      return NextResponse.json(
        {
          success: false,
          error: fleetTableMissingMessage(error.message, 'fleet_service_records'),
        },
        { status: 500 },
      );
    }

    if (status === 'requested' || status === 'in_progress' || body.set_lifecycle_repair === true) {
      await setLifecycleRepair(mixerId);
    }

    if (status === 'done') {
      await syncScheduleAfterDone({
        scheduleId: row.schedule_id,
        serviceDate,
        odometerKm,
      });
    }

    return NextResponse.json({
      success: true,
      record: await withPhotoUrls(normalizeServiceRecord(data as Record<string, unknown>)),
    });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'Ошибка' },
      { status: 500 },
    );
  }
}

/** PATCH — обновить статус / поля записи */
export async function PATCH(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request, FLEET_MUTATION_ROLES);
  if (auth.error) return auth.error;

  try {
    const body = await request.json();
    const id = Number(body.id);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ success: false, error: 'id обязателен' }, { status: 400 });
    }

    const { data: existing, error: loadErr } = await supabaseAdmin
      .from('fleet_service_records')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (loadErr || !existing) {
      return NextResponse.json(
        {
          success: false,
          error: loadErr
            ? fleetTableMissingMessage(loadErr.message, 'fleet_service_records')
            : 'Запись не найдена',
        },
        { status: loadErr ? 500 : 404 },
      );
    }

    const prevStatus = isServiceRecordStatus(existing.status) ? existing.status : 'done';
    const mixerId = Number(existing.mixer_id);

    const patch: Record<string, unknown> = {};
    if (body.status != null) {
      if (!isServiceRecordStatus(body.status)) {
        return NextResponse.json({ success: false, error: 'Некорректный статус' }, { status: 400 });
      }
      patch.status = body.status;
    }
    if (body.service_date !== undefined) {
      patch.service_date = String(body.service_date).slice(0, 10);
    }
    if (body.odometer_km !== undefined) {
      patch.odometer_km =
        body.odometer_km === '' || body.odometer_km == null || !Number.isFinite(Number(body.odometer_km))
          ? null
          : Number(body.odometer_km);
    }
    if (body.description !== undefined) {
      patch.description = body.description ? String(body.description).trim() : null;
    }
    if (body.parts !== undefined) patch.parts = parseParts(body.parts);
    if (body.labor_cost !== undefined) patch.labor_cost = Number(body.labor_cost) || 0;
    if (body.parts_cost !== undefined) patch.parts_cost = Number(body.parts_cost) || 0;
    if (body.performed_by !== undefined) {
      patch.performed_by = body.performed_by ? String(body.performed_by).trim() : null;
    }
    if (body.schedule_id !== undefined) {
      const sid =
        body.schedule_id === '' || body.schedule_id == null ? null : Number(body.schedule_id);
      if (sid != null) {
        if (!Number.isFinite(sid)) {
          return NextResponse.json({ success: false, error: 'Некорректный schedule_id' }, { status: 400 });
        }
        const { data: sched } = await supabaseAdmin
          .from('fleet_service_schedules')
          .select('id')
          .eq('id', sid)
          .eq('mixer_id', mixerId)
          .maybeSingle();
        if (!sched) {
          return NextResponse.json(
            { success: false, error: 'Шаблон ТО не найден у этой машины' },
            { status: 400 },
          );
        }
      }
      patch.schedule_id = sid;
    }
    if (body.photos !== undefined) patch.photos = parsePhotos(body.photos);

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ success: false, error: 'Нечего обновлять' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('fleet_service_records')
      .update(patch)
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      return NextResponse.json(
        {
          success: false,
          error: fleetTableMissingMessage(error.message, 'fleet_service_records'),
        },
        { status: 500 },
      );
    }

    const nextStatus = (patch.status as ServiceRecordStatus | undefined) ?? prevStatus;
    const statusChanged = nextStatus !== prevStatus;

    if (statusChanged && (nextStatus === 'requested' || nextStatus === 'in_progress')) {
      await setLifecycleRepair(mixerId);
    }

    // Синхронизация графика и снятие repair — только при переходе в done
    if (statusChanged && nextStatus === 'done') {
      await syncScheduleAfterDone({
        scheduleId:
          patch.schedule_id !== undefined
            ? (patch.schedule_id as number | null)
            : existing.schedule_id != null
              ? Number(existing.schedule_id)
              : null,
        serviceDate: String(patch.service_date ?? existing.service_date).slice(0, 10),
        odometerKm:
          patch.odometer_km !== undefined
            ? (patch.odometer_km as number | null)
            : existing.odometer_km != null
              ? Number(existing.odometer_km)
              : null,
      });

      if (body.restore_lifecycle !== false) {
        await restoreLifecycleIfNoOpenRequests(mixerId);
      }
    }

    return NextResponse.json({
      success: true,
      record: await withPhotoUrls(normalizeServiceRecord(data as Record<string, unknown>)),
    });
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

  const { data: existing } = await supabaseAdmin
    .from('fleet_service_records')
    .select('id, mixer_id, status')
    .eq('id', id)
    .maybeSingle();

  const { error } = await supabaseAdmin.from('fleet_service_records').delete().eq('id', id);
  if (error) {
    return NextResponse.json(
      {
        success: false,
        error: fleetTableMissingMessage(error.message, 'fleet_service_records'),
      },
      { status: 500 },
    );
  }

  // Удалили открытую заявку — возможно, пора снять «На ремонте»
  if (
    existing &&
    (existing.status === 'requested' || existing.status === 'in_progress')
  ) {
    await restoreLifecycleIfNoOpenRequests(Number(existing.mixer_id));
  }

  return NextResponse.json({ success: true });
}
