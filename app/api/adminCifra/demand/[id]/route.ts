import { NextRequest, NextResponse } from 'next/server';
import { SALES_ROLES, requireAdminCifraStaff } from '@/lib/adminCifraAuth';
import { canProcessTenders } from '@/lib/demandProcessAccess';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

type Ctx = { params: Promise<{ id: string }> };

const STATUSES = ['new', 'relevant', 'ignored', 'taken', 'processing'] as const;

export async function PATCH(request: NextRequest, context: Ctx) {
  const auth = await requireAdminCifraStaff(request, SALES_ROLES);
  if (auth.error) return auth.error;

  const { id: idRaw } = await context.params;
  const id = Number(idRaw);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ success: false, error: 'Некорректный id' }, { status: 400 });
  }

  const body = await request.json();
  if (body.status != null && !STATUSES.includes(body.status)) {
    return NextResponse.json({ success: false, error: 'Некорректный статус' }, { status: 400 });
  }

  const touchesProcessing =
    body.status === 'processing' ||
    (body.processing != null && typeof body.processing === 'object');
  if (touchesProcessing && !canProcessTenders(auth.user)) {
    return NextResponse.json(
      { success: false, error: 'Обработку ведут админы и специалист по торгам' },
      { status: 403 },
    );
  }

  const { data: existing, error: existingError } = await supabaseAdmin
    .from('demand_items')
    .select('id, status, lead_id, raw_payload')
    .eq('id', id)
    .maybeSingle();

  if (existingError || !existing) {
    return NextResponse.json({ success: false, error: 'Не найдено' }, { status: 404 });
  }

  // Уже взятое (с лидом) нельзя откатить в new/ignored/relevant/processing — иначе рассинхрон с лидом.
  if (
    (existing.status === 'taken' || existing.lead_id) &&
    body.status != null &&
    body.status !== 'taken'
  ) {
    return NextResponse.json(
      {
        success: false,
        error: existing.lead_id
          ? `Уже взято в лид #${existing.lead_id} — статус менять нельзя`
          : 'Уже взято — статус менять нельзя',
      },
      { status: 409 },
    );
  }

  const patch: Record<string, unknown> = {};
  if (body.status != null) patch.status = body.status;

  const hasProcessingDraft = body.processing != null && typeof body.processing === 'object';
  if (hasProcessingDraft || body.status === 'processing') {
    const prev =
      existing.raw_payload && typeof existing.raw_payload === 'object'
        ? (existing.raw_payload as Record<string, unknown>)
        : {};
    const nextPayload: Record<string, unknown> = { ...prev };

    if (hasProcessingDraft) {
      nextPayload.processing = body.processing;
      nextPayload.processing_updated_at = new Date().toISOString();
      nextPayload.processing_updated_by = auth.user.user_id;
      nextPayload.processing_updated_by_name = auth.user.full_name || 'Сотрудник';
    }

    if (body.status === 'processing' && !prev.processing_started_at) {
      nextPayload.processing_started_at = new Date().toISOString();
      nextPayload.processing_by = auth.user.user_id;
      nextPayload.processing_by_name = auth.user.full_name || 'Сотрудник';
    }

    patch.raw_payload = nextPayload;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ success: false, error: 'Нет изменений' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('demand_items')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, item: data });
}
