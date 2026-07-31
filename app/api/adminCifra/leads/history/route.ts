import { NextRequest, NextResponse } from 'next/server';
import { SALES_ROLES, requireAdminCifraStaff } from '@/lib/adminCifraAuth';
import { actorFromPayload } from '@/lib/leadHistory';
import { LEAD_SOURCE_LABEL } from '@/lib/leads';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

/** Лок на процесс — React Strict Mode / два параллельных GET не сидят seed дважды. */
let seedInFlight: Promise<void> | null = null;

const HISTORY_KINDS = [
  'status',
  'assign',
  'processing',
  'contract',
  'order',
] as const;
type HistoryKind = (typeof HISTORY_KINDS)[number];

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
  // Берём свежие лиды — иначе при >300 старых новые никогда не получат seed
  const { data: leads, error } = await supabaseAdmin
    .from('leads')
    .select('id, source, status, created_at, raw_payload')
    .order('created_at', { ascending: false })
    .limit(200);
  if (error || !leads?.length) return;

  const leadIds = leads.map((l) => l.id);
  const { data: existing, error: existingError } = await supabaseAdmin
    .from('lead_history')
    .select('lead_id')
    .in('lead_id', leadIds);
  if (existingError) return;

  const hasHistory = new Set((existing ?? []).map((r) => r.lead_id));
  const missing = leads.filter((l) => !hasHistory.has(l.id)).slice(0, 80);
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
      // Всегда «Новый» при создании — текущий статус лида здесь врёт (fulfilled и т.п.)
      new_value: 'new',
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyHistoryKindFilter(query: any, kind: HistoryKind | null) {
  if (!kind) return query;
  switch (kind) {
    case 'status':
      return query.eq('field_name', 'status').not('new_value', 'like', 'converted:%');
    case 'assign':
      return query.in('field_name', ['assigned_to', 'co_assignees']);
    case 'processing':
      return query.in('field_name', ['processing', 'send_to_work']);
    case 'contract':
      return query.eq('field_name', 'contract');
    case 'order':
      return query.or(
        'and(field_name.eq.status,new_value.like.converted:%),action.ilike.%заказ%',
      );
    default:
      return query;
  }
}

/** GET — лента истории лидов (пагинация + фильтры). */
export async function GET(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request, SALES_ROLES);
  if (auth.error) return auth.error;

  const sp = request.nextUrl.searchParams;
  const leadIdRaw = sp.get('leadId');
  const offset = Math.max(0, Number(sp.get('offset') || 0) || 0);
  const limit = Math.min(Math.max(1, Number(sp.get('limit') || 40) || 40), 80);
  const kindRaw = String(sp.get('kind') || '').trim();
  const kind = (HISTORY_KINDS as readonly string[]).includes(kindRaw)
    ? (kindRaw as HistoryKind)
    : null;
  const since = String(sp.get('since') || '').trim() || null;
  const mine = sp.get('mine') === '1' || sp.get('mine') === 'true';
  const actorUserId = auth.user.user_id;

  // Seed/dedupe только на первой странице без узких фильтров — иначе тормозит подгрузку
  if (offset === 0 && !kind && !since && !mine) {
    await ensureLeadHistoryReady();
  }

  let query = supabaseAdmin
    .from('lead_history')
    .select('*')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false });

  if (leadIdRaw) {
    const leadId = Number(leadIdRaw);
    if (!Number.isFinite(leadId)) {
      return NextResponse.json({ success: false, error: 'Некорректный leadId' }, { status: 400 });
    }
    query = query.eq('lead_id', leadId);
  }

  query = applyHistoryKindFilter(query, kind);

  if (since) {
    const d = new Date(since);
    if (!Number.isNaN(d.getTime())) {
      query = query.gte('created_at', d.toISOString());
    }
  }

  if (mine && actorUserId != null) {
    query = query.eq('user_id', actorUserId);
  }

  // +1 чтобы понять, есть ли ещё страница
  query = query.range(offset, offset + limit);

  const { data, error } = await query;
  if (error) {
    console.error('[leads/history GET]', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  const seen = new Set<string>();
  const history = [];
  for (const row of data ?? []) {
    const key = historyDedupeKey(row);
    if (seen.has(key)) continue;
    seen.add(key);
    history.push(row);
  }

  const hasMore = (data?.length ?? 0) > limit;
  if (hasMore && history.length > limit) {
    history.length = limit;
  }

  return NextResponse.json({
    success: true,
    history: hasMore ? history.slice(0, limit) : history,
    hasMore,
    offset,
    limit,
  });
}
