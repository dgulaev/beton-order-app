import { NextRequest, NextResponse } from 'next/server';
import { SALES_ROLES, requireAdminCifraStaff } from '@/lib/adminCifraAuth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { CALLOUT_STATUSES, type CalloutStatus } from '@/lib/callout/labels';
import {
  matchClientForCallout,
  refreshTenderWinner,
} from '@/lib/callout/calloutService';
import { normalizeInn } from '@/lib/callout/parseContacts';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Ctx) {
  const auth = await requireAdminCifraStaff(request, SALES_ROLES);
  if (auth.error) return auth.error;

  const { id: idRaw } = await context.params;
  const id = Number(idRaw);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ success: false, error: 'Некорректный id' }, { status: 400 });
  }

  const { data: prospect, error } = await supabaseAdmin
    .from('callout_prospects')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error || !prospect) {
    return NextResponse.json({ success: false, error: 'Не найдено' }, { status: 404 });
  }

  // Просмотр карточки: «Новый» → «В работе» (чтобы ушёл из фильтра «Новый»)
  let current = prospect;
  let statusChanged = false;
  if (prospect.status === 'new') {
    const { data: moved } = await supabaseAdmin
      .from('callout_prospects')
      .update({ status: 'in_progress', updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('status', 'new')
      .select('*')
      .maybeSingle();
    if (moved) {
      current = moved;
      statusChanged = true;
    }
  }

  const [{ data: tenders }, { data: comments }] = await Promise.all([
    supabaseAdmin
      .from('callout_tenders')
      .select('*')
      .eq('prospect_id', id)
      .order('id', { ascending: false }),
    supabaseAdmin
      .from('callout_comments')
      .select('*')
      .eq('prospect_id', id)
      .order('created_at', { ascending: false })
      .limit(100),
  ]);

  return NextResponse.json({
    success: true,
    prospect: current,
    tenders: tenders || [],
    comments: comments || [],
    statusChanged,
  });
}

export async function PATCH(request: NextRequest, context: Ctx) {
  const auth = await requireAdminCifraStaff(request, SALES_ROLES);
  if (auth.error) return auth.error;

  const { id: idRaw } = await context.params;
  const id = Number(idRaw);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ success: false, error: 'Некорректный id' }, { status: 400 });
  }

  const body = await request.json();
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (body.status != null) {
    if (!CALLOUT_STATUSES.includes(body.status)) {
      return NextResponse.json({ success: false, error: 'Некорректный статус' }, { status: 400 });
    }
    patch.status = body.status as CalloutStatus;
  }
  if (body.organization_name !== undefined) {
    patch.organization_name = String(body.organization_name || '').trim() || null;
  }
  if (body.phone !== undefined) patch.phone = String(body.phone || '').trim() || null;
  if (body.email !== undefined) patch.email = String(body.email || '').trim() || null;
  if (body.address !== undefined) patch.address = String(body.address || '').trim() || null;
  if (body.inn !== undefined) {
    patch.inn = normalizeInn(body.inn);
  }

  // Пересчитать матч с Клиентами при смене ИНН/названия
  if (body.inn !== undefined || body.organization_name !== undefined) {
    const { data: current } = await supabaseAdmin
      .from('callout_prospects')
      .select('inn, organization_name, phone')
      .eq('id', id)
      .maybeSingle();
    const matched = await matchClientForCallout({
      inn: (patch.inn as string | null | undefined) ?? current?.inn,
      organization_name:
        (patch.organization_name as string | null | undefined) ?? current?.organization_name,
    });
    if (matched) {
      patch.matched_client_id = matched.user_id;
      if (!current?.phone && !patch.phone && matched.phone) patch.phone = matched.phone;
      if (!patch.inn && matched.inn) patch.inn = normalizeInn(matched.inn);
    }
  }
  if (body.assigned_to !== undefined) {
    patch.assigned_to =
      body.assigned_to === null || body.assigned_to === ''
        ? null
        : Number(body.assigned_to);
  }

  const { data, error } = await supabaseAdmin
    .from('callout_prospects')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true, prospect: data });
}

export async function DELETE(request: NextRequest, context: Ctx) {
  const auth = await requireAdminCifraStaff(request, SALES_ROLES);
  if (auth.error) return auth.error;

  const { id: idRaw } = await context.params;
  const id = Number(idRaw);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ success: false, error: 'Некорректный id' }, { status: 400 });
  }

  // Удалить закупки карточки, комментарии — cascade
  await supabaseAdmin.from('callout_tenders').delete().eq('prospect_id', id);
  const { error } = await supabaseAdmin.from('callout_prospects').delete().eq('id', id);
  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}

/** Комментарий или refresh тендера: ? через body.action */
export async function POST(request: NextRequest, context: Ctx) {
  const auth = await requireAdminCifraStaff(request, SALES_ROLES);
  if (auth.error) return auth.error;

  const { id: idRaw } = await context.params;
  const id = Number(idRaw);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ success: false, error: 'Некорректный id' }, { status: 400 });
  }

  const body = await request.json();
  const action = String(body.action || 'comment');

  if (action === 'comment') {
    const text = String(body.body || '').trim();
    if (!text) {
      return NextResponse.json({ success: false, error: 'Пустой комментарий' }, { status: 400 });
    }
    const { data, error } = await supabaseAdmin
      .from('callout_comments')
      .insert({
        prospect_id: id,
        user_id: auth.user.user_id,
        user_name: auth.user.full_name || 'Сотрудник',
        user_role: auth.user.role,
        body: text,
      })
      .select('*')
      .single();
    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
    await supabaseAdmin
      .from('callout_prospects')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', id);
    return NextResponse.json({ success: true, comment: data });
  }

  if (action === 'refresh_tender') {
    const tenderId = Number(body.tender_id);
    if (!Number.isFinite(tenderId)) {
      return NextResponse.json({ success: false, error: 'tender_id обязателен' }, { status: 400 });
    }
    const result = await refreshTenderWinner(tenderId);
    return NextResponse.json({ success: result.ok, ...result });
  }

  return NextResponse.json({ success: false, error: 'Неизвестное действие' }, { status: 400 });
}
