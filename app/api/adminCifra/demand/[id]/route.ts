import { NextRequest, NextResponse } from 'next/server';
import { ORDER_MUTATION_ROLES, requireAdminCifraStaff } from '@/lib/adminCifraAuth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

type Ctx = { params: Promise<{ id: string }> };

const STATUSES = ['new', 'relevant', 'ignored', 'taken'] as const;

export async function PATCH(request: NextRequest, context: Ctx) {
  const auth = await requireAdminCifraStaff(request, ORDER_MUTATION_ROLES);
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

  const { data: existing, error: existingError } = await supabaseAdmin
    .from('demand_items')
    .select('id, status, lead_id')
    .eq('id', id)
    .maybeSingle();

  if (existingError || !existing) {
    return NextResponse.json({ success: false, error: 'Не найдено' }, { status: 404 });
  }

  // Уже взятое (с лидом) нельзя откатить в new/ignored/relevant — иначе рассинхрон с лидом.
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
