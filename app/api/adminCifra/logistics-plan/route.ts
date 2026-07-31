import { NextRequest, NextResponse } from 'next/server';
import {
  PLANNER_EDIT_ROLES,
  requireAdminCifraStaff,
} from '@/lib/adminCifraAuth';
import {
  isPlanEditingFresh,
  isPlanEditingRecentlyTouched,
  normalizePlanDateKey,
} from '@/lib/dailyLogisticsPlan';
import { supabaseAdmin as supabase } from '@/lib/supabaseAdmin';

const TABLE_MISSING_RE = /relation .*daily_logistics_plans.* does not exist/i;
const TABLE_HINT =
  'Таблица daily_logistics_plans не найдена. Выполни scripts/daily-logistics-plans-schema.sql в Supabase.';

const SELECT_COLS =
  'delivery_date, payload, max_text, revision, updated_at, updated_by_name, updated_by_role, updated_by_user_id, editing_by_name, editing_by_user_id, editing_at, morning_payload, morning_captured_at';

const SELECT_COLS_NO_MORNING =
  'delivery_date, payload, max_text, revision, updated_at, updated_by_name, updated_by_role, updated_by_user_id, editing_by_name, editing_by_user_id, editing_at';

function tableMissingResponse(errorMessage: string) {
  if (TABLE_MISSING_RE.test(errorMessage || '')) {
    return NextResponse.json({ error: TABLE_HINT }, { status: 503 });
  }
  return null;
}

function mapRow(row: Record<string, unknown>) {
  const dateRaw = String(row.delivery_date || '').substring(0, 10);
  return {
    delivery_date: dateRaw,
    payload: (row.payload && typeof row.payload === 'object' ? row.payload : {}) as Record<
      string,
      unknown
    >,
    max_text: row.max_text != null ? String(row.max_text) : null,
    revision: Number(row.revision) || 1,
    updated_at: row.updated_at ? String(row.updated_at) : null,
    updated_by_name: row.updated_by_name != null ? String(row.updated_by_name) : null,
    updated_by_role: row.updated_by_role != null ? String(row.updated_by_role) : null,
    updated_by_user_id:
      row.updated_by_user_id != null && Number.isFinite(Number(row.updated_by_user_id))
        ? Number(row.updated_by_user_id)
        : null,
    editing_by_name: row.editing_by_name != null ? String(row.editing_by_name) : null,
    editing_by_user_id:
      row.editing_by_user_id != null && Number.isFinite(Number(row.editing_by_user_id))
        ? Number(row.editing_by_user_id)
        : null,
    editing_at: row.editing_at ? String(row.editing_at) : null,
    morning_payload:
      row.morning_payload && typeof row.morning_payload === 'object'
        ? (row.morning_payload as Record<string, unknown>)
        : null,
    morning_captured_at: row.morning_captured_at
      ? String(row.morning_captured_at)
      : null,
  };
}

function shouldCaptureMorning(
  existingMorning: unknown,
  payload: Record<string, unknown>,
  captureMorningFlag: boolean | undefined,
): boolean {
  if (existingMorning && typeof existingMorning === 'object') return false;
  if (captureMorningFlag === true) return true;
  const trips = Array.isArray(payload.trips) ? payload.trips : [];
  if (trips.length === 0) return false;
  const waves = Array.isArray(payload.waves) ? payload.waves : [];
  const hasFullDay = waves.some(
    (w: any) => w && (w.mode === 'full_day' || Number(w.index) === 0),
  );
  // Первый снимок с рейсами без morning — фиксируем (в т.ч. full_day)
  return hasFullDay || waves.length === 0;
}

/** GET ?date=YYYY-MM-DD — общий план дня (staff). */
export async function GET(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request);
  if (auth.error) return auth.error;

  const date = normalizePlanDateKey(
    request.nextUrl.searchParams.get('date') || '',
  );
  if (!date) {
    return NextResponse.json({ error: 'Укажи date=YYYY-MM-DD' }, { status: 400 });
  }

  let data: Record<string, unknown> | null = null;
  let error: { message?: string } | null = null;
  {
    const first = await supabase
      .from('daily_logistics_plans')
      .select(SELECT_COLS)
      .eq('delivery_date', date)
      .maybeSingle();
    data = (first.data as Record<string, unknown> | null) ?? null;
    error = first.error;
  }

  if (error && /morning_/i.test(error.message || '')) {
    const retry = await supabase
      .from('daily_logistics_plans')
      .select(SELECT_COLS_NO_MORNING)
      .eq('delivery_date', date)
      .maybeSingle();
    data = (retry.data as Record<string, unknown> | null) ?? null;
    error = retry.error;
  }

  if (error) {
    const missing = tableMissingResponse(error.message || '');
    if (missing) return missing;
    // Старая схема без editing_* — повторим без этих колонок
    if (/editing_/i.test(error.message || '')) {
      const retry = await supabase
        .from('daily_logistics_plans')
        .select(
          'delivery_date, payload, max_text, revision, updated_at, updated_by_name, updated_by_role, updated_by_user_id',
        )
        .eq('delivery_date', date)
        .maybeSingle();
      if (retry.error) {
        return NextResponse.json({ error: retry.error.message }, { status: 500 });
      }
      if (!retry.data) return NextResponse.json({ plan: null });
      return NextResponse.json({ plan: mapRow(retry.data as Record<string, unknown>) });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ plan: null });
  }

  return NextResponse.json({ plan: mapRow(data as Record<string, unknown>) });
}

/**
 * PUT — upsert общего плана.
 * body: { date, payload, maxText?, expectedRevision? }
 * expectedRevision — etag: если в БД другая revision → 409 «план устарел».
 */
export async function PUT(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request, PLANNER_EDIT_ROLES);
  if (auth.error) return auth.error;

  let body: {
    date?: string;
    payload?: Record<string, unknown>;
    maxText?: string | null;
    expectedRevision?: number | null;
    /** V2: явно зафиксировать утренний снимок (full_day) */
    captureMorning?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Некорректный JSON' }, { status: 400 });
  }

  const date = normalizePlanDateKey(String(body.date || ''));
  if (!date) {
    return NextResponse.json({ error: 'Укажи date=YYYY-MM-DD' }, { status: 400 });
  }
  if (!body.payload || typeof body.payload !== 'object' || Array.isArray(body.payload)) {
    return NextResponse.json({ error: 'Нужен payload объекта черновика' }, { status: 400 });
  }

  let selectCols = SELECT_COLS;
  let existing: Record<string, unknown> | null = null;
  let existErr: { message?: string } | null = null;
  {
    const first = await supabase
      .from('daily_logistics_plans')
      .select(selectCols)
      .eq('delivery_date', date)
      .maybeSingle();
    existing = (first.data as Record<string, unknown> | null) ?? null;
    existErr = first.error;
  }

  if (existErr && /morning_/i.test(existErr.message || '')) {
    selectCols = SELECT_COLS_NO_MORNING;
    const retry = await supabase
      .from('daily_logistics_plans')
      .select(selectCols)
      .eq('delivery_date', date)
      .maybeSingle();
    existing = (retry.data as Record<string, unknown> | null) ?? null;
    existErr = retry.error;
  }

  if (existErr) {
    const missing = tableMissingResponse(existErr.message || '');
    if (missing) return missing;
    return NextResponse.json({ error: existErr.message }, { status: 503 });
  }

  const currentRev = Number(existing?.revision) || 0;
  const hasExpected =
    body.expectedRevision != null &&
    Number.isFinite(Number(body.expectedRevision));
  if (
    hasExpected &&
    existing &&
    currentRev > 0 &&
    Number(body.expectedRevision) !== currentRev
  ) {
    return NextResponse.json(
      {
        error: 'План устарел — кто-то уже сохранил другую версию.',
        code: 'stale_revision',
        plan: mapRow(existing as Record<string, unknown>),
      },
      { status: 409 },
    );
  }

  const nextRevision = currentRev + 1;
  const maxText =
    body.maxText !== undefined
      ? body.maxText == null
        ? null
        : String(body.maxText)
      : existing?.max_text != null
        ? String(existing.max_text)
        : null;

  const captureMorning = shouldCaptureMorning(
    (existing as any)?.morning_payload,
    body.payload,
    body.captureMorning,
  );

  const row: Record<string, unknown> = {
    delivery_date: date,
    payload: body.payload,
    max_text: maxText,
    revision: nextRevision,
    updated_at: new Date().toISOString(),
    updated_by_name: auth.user.full_name || 'Сотрудник',
    updated_by_role: auth.user.role,
    updated_by_user_id: auth.user.user_id,
    editing_by_name: auth.user.full_name || 'Сотрудник',
    editing_by_user_id: auth.user.user_id,
    editing_at: new Date().toISOString(),
  };
  if (captureMorning) {
    row.morning_payload = body.payload;
    row.morning_captured_at = new Date().toISOString();
  }

  // Conditional update по revision — меньше гонок, чем SELECT+upsert.
  if (existing && hasExpected && currentRev > 0) {
    const { data: updated, error: updErr } = await supabase
      .from('daily_logistics_plans')
      .update(row)
      .eq('delivery_date', date)
      .eq('revision', currentRev)
      .select(SELECT_COLS)
      .maybeSingle();
    if (updErr) {
      const missing = tableMissingResponse(updErr.message);
      if (missing) return missing;
      let retryRow = row;
      if (/morning_/i.test(updErr.message || '')) {
        const {
          morning_payload: _mp,
          morning_captured_at: _mc,
          ...withoutMorning
        } = retryRow;
        retryRow = withoutMorning;
      }
      if (/editing_/i.test(updErr.message || '')) {
        const { editing_by_name: _n, editing_by_user_id: _u, editing_at: _a, ...legacy } =
          retryRow;
        retryRow = legacy;
      }
      if (retryRow !== row) {
        const retry = await supabase
          .from('daily_logistics_plans')
          .update(retryRow)
          .eq('delivery_date', date)
          .eq('revision', currentRev)
          .select(
            'delivery_date, payload, max_text, revision, updated_at, updated_by_name, updated_by_role, updated_by_user_id',
          )
          .maybeSingle();
        if (retry.error) {
          return NextResponse.json({ error: retry.error.message }, { status: 500 });
        }
        if (!retry.data) {
          return NextResponse.json(
            {
              error: 'План устарел — кто-то уже сохранил другую версию.',
              code: 'stale_revision',
            },
            { status: 409 },
          );
        }
        return NextResponse.json({
          plan: mapRow(retry.data as Record<string, unknown>),
        });
      }
      return NextResponse.json({ error: updErr.message }, { status: 500 });
    }
    if (!updated) {
      return NextResponse.json(
        {
          error: 'План устарел — кто-то уже сохранил другую версию.',
          code: 'stale_revision',
        },
        { status: 409 },
      );
    }
    return NextResponse.json({ plan: mapRow(updated as Record<string, unknown>) });
  }

  const { data, error } = await supabase
    .from('daily_logistics_plans')
    .upsert(row, { onConflict: 'delivery_date' })
    .select(SELECT_COLS)
    .single();

  if (error) {
    const missing = tableMissingResponse(error.message);
    if (missing) return missing;
    // Fallback без morning_* / editing_* если колонок ещё нет в БД
    let retryRow = row;
    if (/morning_/i.test(error.message || '')) {
      const {
        morning_payload: _mp,
        morning_captured_at: _mc,
        ...withoutMorning
      } = retryRow;
      retryRow = withoutMorning;
    }
    if (/editing_/i.test(error.message || '')) {
      const { editing_by_name: _n, editing_by_user_id: _u, editing_at: _a, ...legacy } =
        retryRow;
      retryRow = legacy;
    }
    if (retryRow !== row) {
      const retry = await supabase
        .from('daily_logistics_plans')
        .upsert(retryRow, { onConflict: 'delivery_date' })
        .select(
          'delivery_date, payload, max_text, revision, updated_at, updated_by_name, updated_by_role, updated_by_user_id',
        )
        .single();
      if (retry.error) {
        return NextResponse.json({ error: retry.error.message }, { status: 500 });
      }
      return NextResponse.json({ plan: mapRow(retry.data as Record<string, unknown>) });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ plan: mapRow(data as Record<string, unknown>) });
}

/**
 * PATCH — heartbeat мягкой блокировки.
 * body: { date, editing: true|false }
 * Не увеличивает revision.
 */
export async function PATCH(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request, PLANNER_EDIT_ROLES);
  if (auth.error) return auth.error;

  let body: { date?: string; editing?: boolean; forceTakeover?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Некорректный JSON' }, { status: 400 });
  }

  const date = normalizePlanDateKey(String(body.date || ''));
  if (!date) {
    return NextResponse.json({ error: 'Укажи date=YYYY-MM-DD' }, { status: 400 });
  }

  const editing = body.editing !== false;
  const forceTakeover = body.forceTakeover === true;
  const { data: existing, error: existErr } = await supabase
    .from('daily_logistics_plans')
    .select(
      'delivery_date, revision, payload, max_text, editing_by_user_id, editing_by_name, editing_at',
    )
    .eq('delivery_date', date)
    .maybeSingle();

  if (existErr) {
    const missing = tableMissingResponse(existErr.message);
    if (missing) return missing;
    return NextResponse.json({ error: existErr.message }, { status: 503 });
  }

  // Нет опубликованного плана — heartbeat не создаёт пустую строку
  if (!existing) {
    return NextResponse.json({ ok: true, plan: null, skipped: 'no_plan' });
  }

  const selfId = Number(auth.user.user_id);
  const otherEditorId =
    existing.editing_by_user_id != null
      ? Number(existing.editing_by_user_id)
      : null;
  const editingAtIso =
    existing.editing_at != null ? String(existing.editing_at) : null;
  const otherFresh =
    otherEditorId != null &&
    otherEditorId !== selfId &&
    isPlanEditingFresh(editingAtIso);

  // При снятии — не затираем чужой heartbeat
  if (!editing) {
    if (otherEditorId != null && otherEditorId !== selfId) {
      return NextResponse.json({ ok: true, skipped: 'other_editor' });
    }
  } else if (otherFresh && !forceTakeover) {
    // Не перехватываем живую блокировку другого диспетчера (без явного takeover)
    return NextResponse.json({
      ok: true,
      skipped: 'locked_by_other',
      editingByName:
        existing.editing_by_name != null
          ? String(existing.editing_by_name)
          : 'коллега',
      plan: mapRow(existing as Record<string, unknown>),
    });
  }

  // Ты уже редактор и editing_at трогали недавно — не UPDATE (иначе realtime
  // шлёт весь payload плана всем подписчикам → «тупит» broadcast).
  if (
    editing &&
    !forceTakeover &&
    otherEditorId === selfId &&
    isPlanEditingRecentlyTouched(editingAtIso)
  ) {
    return NextResponse.json({
      ok: true,
      skipped: 'still_fresh',
      plan: mapRow(existing as Record<string, unknown>),
    });
  }

  const patch = editing
    ? {
        editing_by_name: auth.user.full_name || 'Сотрудник',
        editing_by_user_id: auth.user.user_id,
        editing_at: new Date().toISOString(),
      }
    : {
        editing_by_name: null as string | null,
        editing_by_user_id: null as number | null,
        editing_at: null as string | null,
      };

  const { data, error } = await supabase
    .from('daily_logistics_plans')
    .update(patch)
    .eq('delivery_date', date)
    .select(SELECT_COLS)
    .maybeSingle();

  if (error) {
    if (/editing_/i.test(error.message || '')) {
      return NextResponse.json({ ok: true, plan: null, skipped: 'no_editing_cols' });
    }
    const missing = tableMissingResponse(error.message);
    if (missing) return missing;
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    plan: data ? mapRow(data as Record<string, unknown>) : null,
  });
}

/** DELETE ?date=YYYY-MM-DD — очистить общий план дня. */
export async function DELETE(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request, PLANNER_EDIT_ROLES);
  if (auth.error) return auth.error;

  const date = normalizePlanDateKey(
    request.nextUrl.searchParams.get('date') || '',
  );
  if (!date) {
    return NextResponse.json({ error: 'Укажи date=YYYY-MM-DD' }, { status: 400 });
  }

  const { error } = await supabase
    .from('daily_logistics_plans')
    .delete()
    .eq('delivery_date', date);

  if (error) {
    const missing = tableMissingResponse(error.message);
    if (missing) return missing;
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
