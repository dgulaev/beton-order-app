import { NextRequest, NextResponse } from 'next/server';
import { SALES_ROLES, requireAdminCifraStaff } from '@/lib/adminCifraAuth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { CALLOUT_STATUSES, type CalloutStatus } from '@/lib/callout/labels';
import {
  importCalloutRows,
  deleteImportBatch,
  enrichNamelessProspects,
  type ImportRow,
} from '@/lib/callout/calloutService';

export async function GET(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request, SALES_ROLES);
  if (auth.error) return auth.error;

  const status = request.nextUrl.searchParams.get('status');
  const q = (request.nextUrl.searchParams.get('q') || '').trim();
  const limit = Math.min(Number(request.nextUrl.searchParams.get('limit') || 100), 300);

  let query = supabaseAdmin
    .from('callout_prospects')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(limit);

  if (status && CALLOUT_STATUSES.includes(status as CalloutStatus)) {
    query = query.eq('status', status);
  }
  if (q) {
    // Простой поиск: inn или название
    query = query.or(
      `inn.ilike.%${q}%,organization_name.ilike.%${q}%,phone.ilike.%${q}%`,
    );
  }

  const { data: prospects, error } = await query;
  if (error) {
    console.error('[callout GET]', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

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
  const { data: pendingTenders } = await supabaseAdmin
    .from('callout_tenders')
    .select('*')
    .is('prospect_id', null)
    .order('updated_at', { ascending: false })
    .limit(150);

  return NextResponse.json({
    success: true,
    prospects: prospects || [],
    tendersByProspect,
    commentCounts,
    importBatches,
    pendingTenders: pendingTenders || [],
    prospectTotal: prospectTotal ?? 0,
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

    return NextResponse.json({ success: false, error: 'Неизвестное действие' }, { status: 400 });
  } catch (e) {
    console.error('[callout POST]', e);
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'Ошибка' },
      { status: 500 },
    );
  }
}
