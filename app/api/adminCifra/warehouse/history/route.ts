import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  formatSiloCementJournalActor,
  siloIdFromItemType,
} from '@/lib/siloConfig';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/** Границы календарного дня YYYY-MM-DD в Europe/Moscow (UTC+3, без DST). */
function moscowDayBounds(dateKey: string): { start: string; end: string } {
  const start = new Date(`${dateKey}T00:00:00+03:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

function hasOrderRef(userName: string | null | undefined): boolean {
  return /заявка\s*#\s*\d+/i.test(String(userName || ''));
}

/**
 * Для старых записей без «заявка #N» подтягиваем номер заявки
 * из order_mixers по кг/силосу/времени списания.
 */
async function enrichSiloOpsWithOrders(
  ops: any[],
  dateKey: string,
): Promise<any[]> {
  if (!ops.length) return ops;

  const { start, end } = moscowDayBounds(dateKey);
  const { data: mixers, error } = await supabase
    .from('order_mixers')
    .select('order_id, cement_write_off_kg, cement_write_off_silo_id, cement_write_off_at')
    .not('cement_write_off_kg', 'is', null)
    .gte('cement_write_off_at', start)
    .lt('cement_write_off_at', end);

  if (error || !mixers?.length) return ops;

  const used = new Set<number>();

  return ops.map((op) => {
    if (hasOrderRef(op.user_name)) return op;
    if (op.operation_type !== 'subtract') return op;

    const siloId = siloIdFromItemType(op.item_type);
    if (siloId == null) return op;

    const amount = Number(op.amount || 0);
    const opTime = new Date(op.created_at).getTime();
    if (!Number.isFinite(opTime)) return op;

    let bestIdx = -1;
    let bestDist = Infinity;
    let bestOrderId = 0;
    for (let idx = 0; idx < mixers.length; idx += 1) {
      if (used.has(idx)) continue;
      const m = mixers[idx];
      if (Number(m.cement_write_off_silo_id) !== siloId) continue;
      if (Math.abs(Number(m.cement_write_off_kg) - amount) > 0.2) continue;
      const writeAt = m.cement_write_off_at
        ? new Date(m.cement_write_off_at).getTime()
        : NaN;
      if (!Number.isFinite(writeAt)) continue;
      const dist = Math.abs(writeAt - opTime);
      if (dist > 10 * 60 * 1000) continue;
      if (dist < bestDist) {
        bestIdx = idx;
        bestDist = dist;
        bestOrderId = Number(m.order_id);
      }
    }

    if (bestIdx < 0 || !Number.isFinite(bestOrderId) || bestOrderId <= 0) return op;
    used.add(bestIdx);

    const raw = String(op.user_name || '').trim();
    const isBackfill = /задним числом/i.test(raw);
    const baseName = raw.replace(/\s*\(задним числом\)\s*$/i, '').trim();

    return {
      ...op,
      order_id: bestOrderId,
      user_name: formatSiloCementJournalActor({
        kind: isBackfill ? 'backfill' : 'auto_writeoff',
        orderId: bestOrderId,
        // Старые автосписания писали только имя смены; backfill — ФИО админа
        operatorName: isBackfill ? null : baseName || null,
        actorName: baseName || null,
      }),
    };
  });
}

type ItemFilter = 'all' | 'silo1' | 'silo2' | 'silo3' | 'additives' | 'fbs';

function parseItemFilter(raw: string | null): ItemFilter {
  const v = String(raw || 'all').toLowerCase();
  if (v === 'silo1' || v === 'silo2' || v === 'silo3' || v === 'additives' || v === 'fbs') {
    return v;
  }
  return 'all';
}

function applyItemFilter(query: any, item: ItemFilter, scope: string | null) {
  // Журнал силосов (модалка): только цементные силосы, опционально один из них
  if (scope === 'silos') {
    if (item === 'silo1') return query.ilike('item_type', '%Силос 1%');
    if (item === 'silo2') return query.ilike('item_type', '%Силос 2%');
    if (item === 'silo3') return query.ilike('item_type', '%Силос 3%');
    return query.ilike('item_type', '%Силос%');
  }

  if (item === 'silo1') return query.ilike('item_type', '%Силос 1%');
  if (item === 'silo2') return query.ilike('item_type', '%Силос 2%');
  if (item === 'silo3') return query.ilike('item_type', '%Силос 3%');
  if (item === 'additives') {
    return query.or(
      'item_type.ilike.%ПФМ%,item_type.ilike.%Линомикс%,item_type.ilike.%Добавка%,item_type.ilike.%НЛК%',
    );
  }
  if (item === 'fbs') {
    return query.or('unit.eq.шт,item_type.ilike.%ФБС%,item_type.ilike.%блок%');
  }
  return query;
}

export async function GET(request: NextRequest) {
  try {
    const scope = request.nextUrl.searchParams.get('scope');
    const dateParam = request.nextUrl.searchParams.get('date');
    const dateKey =
      dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : null;
    const item = parseItemFilter(request.nextUrl.searchParams.get('item'));
    const limitRaw = Number(request.nextUrl.searchParams.get('limit') || 40);
    const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 40, 1), 1000);
    const offsetRaw = Number(request.nextUrl.searchParams.get('offset') || 0);
    const offset = Math.max(0, Number.isFinite(offsetRaw) ? Math.floor(offsetRaw) : 0);
    // paged=1 — новый формат { items, hasMore }; иначе массив (обратная совместимость)
    const paged = request.nextUrl.searchParams.get('paged') === '1';

    let query = supabase
      .from('warehouse_operations')
      .select('*')
      .order('created_at', { ascending: false });

    query = applyItemFilter(query, item, scope);

    if (dateKey) {
      const { start, end } = moscowDayBounds(dateKey);
      query = query.gte('created_at', start).lt('created_at', end);
    }

    // Берём +1, чтобы понять, есть ли ещё страница
    query = query.range(offset, offset + limit);

    const { data, error } = await query;

    if (error) {
      console.error('GET history error:', error);
      return NextResponse.json(paged ? { items: [], hasMore: false } : []);
    }

    let rows = data || [];
    const hasMore = rows.length > limit;
    if (hasMore) rows = rows.slice(0, limit);

    if (scope === 'silos' && dateKey) {
      rows = await enrichSiloOpsWithOrders(rows, dateKey);
    }

    if (paged) {
      return NextResponse.json({ items: rows, hasMore, offset, limit });
    }
    return NextResponse.json(rows);
  } catch (error) {
    console.error('GET history error:', error);
    return NextResponse.json(
      request.nextUrl.searchParams.get('paged') === '1'
        ? { items: [], hasMore: false }
        : [],
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const userName =
      typeof body.user_name === 'string' && body.user_name.trim()
        ? body.user_name.trim().slice(0, 120)
        : null;

    const { error } = await supabase
      .from('warehouse_operations')
      .insert({
        operation_type: body.operation_type || 'unknown',
        item_type: body.item_type || 'Неизвестно',
        amount: Number(body.amount || 0),
        old_value: Number(body.old_value || 0),
        new_value: Number(body.new_value || 0),
        unit: body.unit || 'л',
        user_name: userName,
        // НЕ отправляем 'action' — её нет в таблице
      });

    if (error) {
      console.error('POST history error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

   // console.log('✅ История успешно сохранена в базу');
    return NextResponse.json({ success: true });

  } catch (error: any) {
    console.error('💥 Ошибка POST history:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
