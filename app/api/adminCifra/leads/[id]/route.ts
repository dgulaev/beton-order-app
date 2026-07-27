import { NextRequest, NextResponse } from 'next/server';
import { SALES_ROLES, requireAdminCifraStaff } from '@/lib/adminCifraAuth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { maybeMarkClientSpamFromLead } from '@/lib/clientSpam';
import { LEAD_STATUSES } from '@/lib/leads';

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: Ctx) {
  const auth = await requireAdminCifraStaff(request, SALES_ROLES);
  if (auth.error) return auth.error;

  const { id: idRaw } = await context.params;
  const id = Number(idRaw);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ success: false, error: 'Некорректный id' }, { status: 400 });
  }

  try {
    const body = await request.json();
    const patch: Record<string, unknown> = {};

    // Конверсия (converted + order_id) — только через POST /api/order
    if (body.order_id !== undefined) {
      return NextResponse.json(
        { success: false, error: 'order_id меняется только при создании заявки из лида' },
        { status: 400 },
      );
    }
    if (body.status === 'converted') {
      return NextResponse.json(
        { success: false, error: 'Статус «В заказ» выставляется только при создании заявки' },
        { status: 400 },
      );
    }

    const { data: existing, error: existingError } = await supabaseAdmin
      .from('leads')
      .select('id, status, order_id')
      .eq('id', id)
      .maybeSingle();

    if (existingError || !existing) {
      return NextResponse.json({ success: false, error: 'Лид не найден' }, { status: 404 });
    }

    // Уже конвертированный лид нельзя откатить в new/rejected/spam — иначе ломается связка с заказом.
    if (
      existing.status === 'converted' &&
      body.status != null &&
      body.status !== 'converted'
    ) {
      return NextResponse.json(
        {
          success: false,
          error: existing.order_id
            ? `Лид уже в заказе #${existing.order_id} — статус менять нельзя`
            : 'Лид уже конвертирован — статус менять нельзя',
        },
        { status: 409 },
      );
    }

    if (body.status != null) {
      if (!LEAD_STATUSES.includes(body.status)) {
        return NextResponse.json({ success: false, error: 'Некорректный статус' }, { status: 400 });
      }
      patch.status = body.status;
    }
    if (body.assigned_to !== undefined) patch.assigned_to = body.assigned_to;
    if (body.phone !== undefined) patch.phone = body.phone;
    if (body.name !== undefined) patch.name = body.name;
    if (body.grade !== undefined) patch.grade = body.grade;
    if (body.volume_m3 !== undefined) patch.volume_m3 = body.volume_m3;
    if (body.address !== undefined) patch.address = body.address;
    if (body.city !== undefined) patch.city = body.city;
    if (body.desired_date !== undefined) patch.desired_date = body.desired_date;
    if (body.raw_text !== undefined) patch.raw_text = body.raw_text;

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ success: false, error: 'Нет полей для обновления' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('leads')
      .update(patch)
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    let clientSpam: Awaited<ReturnType<typeof maybeMarkClientSpamFromLead>> | null = null;
    if (data?.status === 'spam') {
      clientSpam = await maybeMarkClientSpamFromLead({
        phone: data.phone,
        raw_payload: data.raw_payload as Record<string, unknown> | null,
      });
    }

    return NextResponse.json({
      success: true,
      lead: data,
      ...(clientSpam
        ? {
            clientSpamMarked: clientSpam.marked,
            clientSpamUserId: clientSpam.userId ?? null,
            clientSpamSkipped: clientSpam.skippedReason ?? null,
          }
        : {}),
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Ошибка';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
