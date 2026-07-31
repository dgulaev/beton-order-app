import { NextRequest, NextResponse } from 'next/server';
import { SALES_ROLES, requireAdminCifraStaff } from '@/lib/adminCifraAuth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { CALLOUT_STATUSES, type CalloutStatus } from '@/lib/callout/labels';
import {
  importCalloutRows,
  deleteImportBatch,
  enrichNamelessProspects,
  enrichProspectContactsFromEis,
  type ImportRow,
} from '@/lib/callout/calloutService';

/** Долгий прогон ЕИС (force enrich) — иначе Vercel рвёт на ~60с. */
export const maxDuration = 300;

function escapePostgrestOrValue(raw: string): string {
  return raw
    .replace(/\\/g, '')
    .replace(/[%_]/g, '')
    .replace(/[,.()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

export async function GET(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request, SALES_ROLES);
  if (auth.error) return auth.error;

  const status = request.nextUrl.searchParams.get('status');
  const q = escapePostgrestOrValue(request.nextUrl.searchParams.get('q') || '');
  const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get('limit') || 50), 1), 100);
  const page = Math.max(Number(request.nextUrl.searchParams.get('page') || 1), 1);
  const offset = (page - 1) * limit;

  let countQuery = supabaseAdmin
    .from('callout_prospects')
    .select('id', { count: 'exact', head: true });

  let query = supabaseAdmin
    .from('callout_prospects')
    .select('*')
    .order('updated_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (status && CALLOUT_STATUSES.includes(status as CalloutStatus)) {
    query = query.eq('status', status);
    countQuery = countQuery.eq('status', status);
  }
  if (q) {
    const orFilter = `inn.ilike.%${q}%,organization_name.ilike.%${q}%,phone.ilike.%${q}%`;
    query = query.or(orFilter);
    countQuery = countQuery.or(orFilter);
  }

  const [{ data: prospects, error }, { count: filteredTotal, error: countError }] =
    await Promise.all([query, countQuery]);

  if (error) {
    console.error('[callout GET]', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
  if (countError) {
    console.error('[callout GET count]', countError);
  }

  const filteredCount = filteredTotal ?? (prospects || []).length;
  const totalPages = Math.max(1, Math.ceil(filteredCount / limit));

  // Общий счётчик карточек (для бейджа вкладки, без фильтра статуса)
  const { count: prospectTotal } = await supabaseAdmin
    .from('callout_prospects')
    .select('id', { count: 'exact', head: true });

  const ids = (prospects || []).map((p) => p.id);
  let tendersByProspect: Record<number, unknown[]> = {};
  let commentCounts: Record<number, number> = {};

  if (ids.length) {
    const { data: tenders } = await supabaseAdmin
      .from('callout_tenders')
      .select('*')
      .in('prospect_id', ids)
      .order('id', { ascending: false });

    tendersByProspect = {};
    for (const t of tenders || []) {
      const pid = Number(t.prospect_id);
      if (!tendersByProspect[pid]) tendersByProspect[pid] = [];
      tendersByProspect[pid].push(t);
    }

    const { data: comments } = await supabaseAdmin
      .from('callout_comments')
      .select('prospect_id')
      .in('prospect_id', ids);
    commentCounts = {};
    for (const c of comments || []) {
      const pid = Number(c.prospect_id);
      commentCounts[pid] = (commentCounts[pid] || 0) + 1;
    }
  }

  // Батчи импорта (для кнопки удаления)
  const { data: batches } = await supabaseAdmin
    .from('callout_tenders')
    .select('import_batch')
    .not('import_batch', 'is', null)
    .limit(500);
  const importBatches = Array.from(
    new Set((batches || []).map((b) => b.import_batch).filter(Boolean)),
  );

  // Закупки без карточки (ждём победителя)
  const { data: pendingRaw } = await supabaseAdmin
    .from('callout_tenders')
    .select('*')
    .is('prospect_id', null)
    .order('updated_at', { ascending: false })
    .limit(150);

  // Заказчик (кто проводит торги) — из лида, пока нет победителя в «К обзвону»
  const pendingLeadIds = Array.from(
    new Set(
      (pendingRaw || [])
        .map((t) => Number(t.lead_id))
        .filter((id) => Number.isFinite(id) && id > 0),
    ),
  );
  const customerByLead: Record<number, string> = {};
  if (pendingLeadIds.length) {
    const { data: leads } = await supabaseAdmin
      .from('leads')
      .select('id, name, raw_payload')
      .in('id', pendingLeadIds);
    for (const lead of leads || []) {
      const payload =
        lead.raw_payload && typeof lead.raw_payload === 'object'
          ? (lead.raw_payload as Record<string, unknown>)
          : {};
      const org = String(payload.organization_name || '').trim();
      const name = String(lead.name || '').trim();
      if (org) customerByLead[Number(lead.id)] = org;
      else if (name && !/бетон|м\d/i.test(name)) customerByLead[Number(lead.id)] = name;
    }
  }

  const pendingTenders = (pendingRaw || []).map((t) => {
    const fromCol =
      t.customer_name != null ? String(t.customer_name).trim() : '';
    const fromLead = t.lead_id != null ? customerByLead[Number(t.lead_id)] : '';
    return {
      ...t,
      customer_name: fromCol || fromLead || null,
    };
  });

  return NextResponse.json({
    success: true,
    prospects: prospects || [],
    tendersByProspect,
    commentCounts,
    importBatches,
    pendingTenders,
    prospectTotal: prospectTotal ?? 0,
    page,
    limit,
    filteredTotal: filteredCount,
    totalPages,
  });
}

/** Импорт строк Excel / создание. */
export async function POST(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request, SALES_ROLES);
  if (auth.error) return auth.error;

  try {
    const body = await request.json();
    const action = String(body.action || 'import');

    if (action === 'import') {
      const rows = Array.isArray(body.rows) ? (body.rows as ImportRow[]) : [];
      if (!rows.length) {
        return NextResponse.json({ success: false, error: 'Нет строк для импорта' }, { status: 400 });
      }
      const batchId =
        String(body.batch_id || '').trim() ||
        `xlsx-${new Date().toISOString().slice(0, 10)}-${Date.now()}`;
      const result = await importCalloutRows(rows, batchId);
      return NextResponse.json({ success: true, batch_id: batchId, ...result });
    }

    if (action === 'delete_batch') {
      const batchId = String(body.batch_id || '').trim();
      if (!batchId) {
        return NextResponse.json({ success: false, error: 'batch_id обязателен' }, { status: 400 });
      }
      const result = await deleteImportBatch(batchId);
      return NextResponse.json({ success: true, ...result });
    }

    if (action === 'enrich_names') {
      const result = await enrichNamelessProspects(40);
      return NextResponse.json({ success: true, ...result });
    }

    if (action === 'enrich_contacts_eis') {
      const limitRaw = Number(body.limit);
      // Маленький batch: каждая карточка = несколько запросов к ЕИС
      const limit =
        Number.isFinite(limitRaw) && limitRaw > 0
          ? Math.min(Math.floor(limitRaw), 12)
          : 8;
      const preferRaw = Number(body.prospect_id);
      const preferProspectId =
        Number.isFinite(preferRaw) && preferRaw > 0 ? preferRaw : null;
      const result = await enrichProspectContactsFromEis(limit, {
        force: body.force !== false,
        preferProspectId,
      });
      return NextResponse.json({ success: true, ...result });
    }

    return NextResponse.json({ success: false, error: 'Неизвестное действие' }, { status: 400 });
  } catch (e) {
    console.error('[callout POST]', e);
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'Ошибка' },
      { status: 500 },
    );
  }
}
