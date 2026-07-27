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

  const patch: Record<string, unknown> = {};
  if (body.status != null) patch.status = body.status;

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
