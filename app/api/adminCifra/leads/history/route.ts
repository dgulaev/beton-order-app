import { NextRequest, NextResponse } from 'next/server';
import { SALES_ROLES, requireAdminCifraStaff } from '@/lib/adminCifraAuth';
import { actorFromPayload } from '@/lib/leadHistory';
import { LEAD_SOURCE_LABEL } from '@/lib/leads';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

/** Лок на процесс — React Strict Mode / два параллельных GET не сидят seed дважды. */
let seedInFlight: Promise<void> | null = null;

function historyDedupeKey(row: {
  lead_id: number;
  action: string;
  created_at: string;
  field_name?: string | null;
  old_value?: string | null;
  new_value?: string | null;
}): string {
  return [
    row.lead_id,
    row.action,
    row.created_at,
    row.field_name ?? '',
    row.old_value ?? '',
    row.new_value ?? '',
  ].join('|');
}

/** Удаляет полные дубликаты (оставляет запись с меньшим id). */
async function dedupeLeadHistoryRows(): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from('lead_history')
    .select('id, lead_id, action, created_at, field_name, old_value, new_value')
    .order('id', { ascending: true })
    .limit(2000);
  if (error || !data?.length) return;

  const seen = new Set<string>();
  const toDelete: number[] = [];
  for (const row of data) {
    const key = historyDedupeKey(row);
    if (seen.has(key)) toDelete.push(row.id);
    else seen.add(key);
  }
  if (toDelete.length === 0) return;

  const { error: delError } = await supabaseAdmin
    .from('lead_history')
    .delete()
    .in('id', toDelete);
  if (delError) console.error('[leads/history dedupe]', delError.message);
}

/**
 * Seed только для лидов без единой записи в истории.
 * Идемпотентно: повторный вызов не плодит дубли.
 */
async function seedMissingLeadHistory(): Promise<void> {
  const { data: leads, error } = await supabaseAdmin
    .from('leads')
    .select('id, source, status, created_at, raw_payload')
    .order('created_at', { ascending: true })
    .limit(300);
  if (error || !leads?.length) return;

  const leadIds = leads.map((l) => l.id);
  const { data: existing, error: existingError } = await supabaseAdmin
    .from('lead_history')
    .select('lead_id')
    .in('lead_id', leadIds);
  if (existingError) return;

  const hasHistory = new Set((existing ?? []).map((r) => r.lead_id));
  const missing = leads.filter((l) => !hasHistory.has(l.id));
  if (missing.length === 0) return;

  const rows = missing.map((lead) => {
    const actor = actorFromPayload(lead.raw_payload as Record<string, unknown> | null);
    const sourceLabel = LEAD_SOURCE_LABEL[lead.source] || lead.source;
    const isStaff = Boolean(actor.user_id || actor.user_name);
    const action =
      lead.source === 'demand' && isStaff
        ? 'Одобрил лид из спроса'
        : isStaff
          ? 'Создал лид'
          : 'Поступил новый лид';
    return {
      lead_id: lead.id,
      action,
      user_id: actor.user_id,
      user_name: actor.user_name || sourceLabel || 'Система',
      user_role: actor.user_role || (isStaff ? null : 'system'),
      field_name: 'status',
      old_value: null,
      new_value: lead.status,
      created_at: lead.created_at,
    };
  });

  const { error: insertError } = await supabaseAdmin.from('lead_history').insert(rows);
  if (insertError) console.error('[leads/history seed]', insertError.message);
}

async function ensureLeadHistoryReady(): Promise<void> {
  if (!seedInFlight) {
    seedInFlight = (async () => {
      await dedupeLeadHistoryRows();
      await seedMissingLeadHistory();
    })().finally(() => {
      seedInFlight = null;
    });
  }
  await seedInFlight;
}

/** GET — лента истории лидов (все или по leadId). */
export async function GET(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request, SALES_ROLES);
  if (auth.error) return auth.error;

  const leadIdRaw = request.nextUrl.searchParams.get('leadId');
  const limit = Math.min(Number(request.nextUrl.searchParams.get('limit') || 80), 200);

  await ensureLeadHistoryReady();

  let query = supabaseAdmin
    .from('lead_history')
    .select('*')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit);

  if (leadIdRaw) {
    const leadId = Number(leadIdRaw);
    if (!Number.isFinite(leadId)) {
      return NextResponse.json({ success: false, error: 'Некорректный leadId' }, { status: 400 });
    }
    query = query.eq('lead_id', leadId);
  }

  const { data, error } = await query;
  if (error) {
    console.error('[leads/history GET]', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  // Страховка на ответ: даже если в БД ещё мелькнул дубль — в UI один раз.
  const seen = new Set<string>();
  const history = [];
  for (const row of data ?? []) {
    const key = historyDedupeKey(row);
    if (seen.has(key)) continue;
    seen.add(key);
    history.push(row);
  }

  return NextResponse.json({ success: true, history });
}
