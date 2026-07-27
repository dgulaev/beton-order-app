import { NextRequest, NextResponse } from 'next/server';
import { ORDER_MUTATION_ROLES, requireAdminCifraStaff } from '@/lib/adminCifraAuth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { upsertLead } from '@/lib/leadService';

type Ctx = { params: Promise<{ id: string }> };

/** Взять спрос в работу → создать лид. */
export async function POST(request: NextRequest, context: Ctx) {
  const auth = await requireAdminCifraStaff(request, ORDER_MUTATION_ROLES);
  if (auth.error) return auth.error;

  const { id: idRaw } = await context.params;
  const id = Number(idRaw);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ success: false, error: 'Некорректный id' }, { status: 400 });
  }

  const { data: item, error } = await supabaseAdmin
    .from('demand_items')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !item) {
    return NextResponse.json({ success: false, error: 'Не найдено' }, { status: 404 });
  }

  if (item.status === 'ignored') {
    return NextResponse.json(
      { success: false, error: 'Запись в игноре — сначала верните в «Новые»' },
      { status: 409 },
    );
  }

  if (item.lead_id || item.status === 'taken') {
    const { data: existingLead } = item.lead_id
      ? await supabaseAdmin.from('leads').select('*').eq('id', item.lead_id).maybeSingle()
      : { data: null };
    return NextResponse.json({
      success: true,
      lead: existingLead,
      already: true,
    });
  }

  const result = await upsertLead({
    source: 'demand',
    external_id: `demand:${item.id}`,
    status: 'new',
    raw_text: [item.title, item.body, item.external_url].filter(Boolean).join('\n\n'),
    grade: item.grades?.[0] ?? null,
    volume_m3: item.volume_m3,
    city: item.region,
    address: item.region,
    score: item.fit_score ?? 50,
    raw_payload: { demand_id: item.id, source: item.source },
  });

  if (!result) {
    return NextResponse.json({ success: false, error: 'Не удалось создать лид' }, { status: 500 });
  }

  // Атомарно: только если ещё никто не привязал lead_id (защита от двойного клика).
  const { data: linked, error: linkError } = await supabaseAdmin
    .from('demand_items')
    .update({ status: 'taken', lead_id: result.lead.id })
    .eq('id', id)
    .is('lead_id', null)
    .select('*')
    .maybeSingle();

  if (linkError) {
    return NextResponse.json({ success: false, error: linkError.message }, { status: 500 });
  }

  if (!linked) {
    const { data: again } = await supabaseAdmin
      .from('demand_items')
      .select('lead_id')
      .eq('id', id)
      .maybeSingle();
    const { data: existingLead } = again?.lead_id
      ? await supabaseAdmin.from('leads').select('*').eq('id', again.lead_id).maybeSingle()
      : { data: null };
    return NextResponse.json({
      success: true,
      lead: existingLead || result.lead,
      already: true,
    });
  }

  return NextResponse.json({ success: true, lead: result.lead, created: result.created });
}
