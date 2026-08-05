import { NextRequest, NextResponse } from 'next/server';
import { FLEET_MUTATION_ROLES, requireAdminCifraStaff } from '@/lib/adminCifraAuth';
import { fleetTableMissingMessage } from '@/lib/fleetDocumentsServer';
import { isFleetReminderKind, isFleetReminderStatus } from '@/lib/fleetLifecycle';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

/** GET — напоминания (?mixer_id=, опционально status=pending) */
export async function GET(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request);
  if (auth.error) return auth.error;

  const mixerId = request.nextUrl.searchParams.get('mixer_id');
  const status = request.nextUrl.searchParams.get('status');

  let query = supabaseAdmin.from('fleet_reminders').select('*').order('due_date', { ascending: true });

  if (mixerId) {
    const id = Number(mixerId);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ success: false, error: 'Некорректный mixer_id' }, { status: 400 });
    }
    query = query.eq('mixer_id', id);
  }
  if (status) query = query.eq('status', status);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json(
      { success: false, error: fleetTableMissingMessage(error.message, 'fleet_reminders') },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true, reminders: data ?? [] });
}

/** POST — создать напоминание */
export async function POST(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request, FLEET_MUTATION_ROLES);
  if (auth.error) return auth.error;

  try {
    const body = await request.json();
    const { mixer_id, kind, title, due_date, due_odometer } = body;

    if (!mixer_id || !title) {
      return NextResponse.json({ success: false, error: 'mixer_id и title обязательны' }, { status: 400 });
    }

    const resolvedKind = kind == null || kind === '' ? 'custom' : kind;
    if (!isFleetReminderKind(resolvedKind)) {
      return NextResponse.json(
        { success: false, error: 'kind: document_expiry | service_due | custom' },
        { status: 400 },
      );
    }

    const { data, error } = await supabaseAdmin
      .from('fleet_reminders')
      .insert({
        mixer_id: Number(mixer_id),
        kind: resolvedKind,
        title: String(title),
        due_date: due_date || null,
        due_odometer: due_odometer != null ? Number(due_odometer) : null,
        status: 'pending',
      })
      .select('*')
      .single();

    if (error) {
      return NextResponse.json(
        { success: false, error: fleetTableMissingMessage(error.message, 'fleet_reminders') },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true, reminder: data });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Ошибка';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

/** PATCH — обновить статус напоминания */
export async function PATCH(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request, FLEET_MUTATION_ROLES);
  if (auth.error) return auth.error;

  try {
    const body = await request.json();
    const { id, status } = body;
    if (!id || !status) {
      return NextResponse.json({ success: false, error: 'id и status обязательны' }, { status: 400 });
    }
    if (!isFleetReminderStatus(status)) {
      return NextResponse.json(
        { success: false, error: 'status: pending | done | dismissed' },
        { status: 400 },
      );
    }

    const { data, error } = await supabaseAdmin
      .from('fleet_reminders')
      .update({ status })
      .eq('id', Number(id))
      .select('*')
      .single();

    if (error) {
      return NextResponse.json(
        { success: false, error: fleetTableMissingMessage(error.message, 'fleet_reminders') },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true, reminder: data });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Ошибка';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
