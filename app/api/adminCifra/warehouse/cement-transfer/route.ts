// Админ: перенос уже записанного списания цемента с одного силоса на другой.
// Пример: списали с Силоса 2, а реально крутили с Силоса 1.
import { NextRequest, NextResponse } from 'next/server';
import { requireAdminCifraStaff } from '@/lib/adminCifraAuth';
import {
  listCementSegments,
  syncMixerCementAggregate,
} from '@/lib/cementSegments';
import {
  formatSiloCementJournalActor,
  siloNameById,
  syncSiloLowRateAlert,
} from '@/lib/siloConfig';
import { supabaseAdmin as supabase } from '@/lib/supabaseAdmin';

function moscowDateStr(d: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function moscowDayBounds(dateKey: string): { start: string; end: string } {
  const start = new Date(`${dateKey}T00:00:00+03:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

function authAdmin(request: NextRequest) {
  return requireAdminCifraStaff(request, ['admin']);
}

type TripRow = {
  /** order_mixer id */
  id: number;
  /** Уникальный ключ строки UI (сегмент или рейс) */
  rowKey: string;
  segmentId: number | null;
  orderId: number;
  mixerName: string;
  volume: number;
  status: string;
  grade: string | null;
  deliveryDate: string | null;
  siloId: number;
  siloName: string;
  cementKg: number;
  writeOffAt: string | null;
  segmentKind: string | null;
};

async function loadTrips(opts: {
  dateIso: string;
  fromSiloId: number | null;
  orderId: number | null;
}): Promise<TripRow[]> {
  const { start, end } = moscowDayBounds(opts.dateIso);

  let query = supabase
    .from('order_mixers')
    .select(`
      id,
      order_id,
      mixer_name,
      volume,
      status,
      cement_write_off_kg,
      cement_write_off_silo_id,
      cement_write_off_at,
      orders!inner (
        id,
        delivery_date,
        grade
      )
    `)
    .not('cement_write_off_kg', 'is', null)
    .not('cement_write_off_silo_id', 'is', null)
    .gte('cement_write_off_at', start)
    .lt('cement_write_off_at', end)
    .order('cement_write_off_at', { ascending: false })
    .limit(500);

  if (opts.orderId != null) {
    query = query.eq('order_id', opts.orderId);
  }

  const { data, error } = await query;
  if (error) throw error;

  const out: TripRow[] = [];
  for (const row of data || []) {
    const mixerId = Number(row.id);
    const base = {
      id: mixerId,
      orderId: Number(row.order_id),
      mixerName: String(row.mixer_name || `Миксер #${row.id}`),
      volume: Number(row.volume || 0),
      status: String(row.status || ''),
      grade: (row as any).orders?.grade ? String((row as any).orders.grade) : null,
      deliveryDate: (row as any).orders?.delivery_date
        ? String((row as any).orders.delivery_date)
        : null,
    };

    const segments = await listCementSegments(mixerId);
    if (segments.length > 0) {
      for (const seg of segments) {
        if (opts.fromSiloId != null && seg.silo_id !== opts.fromSiloId) continue;
        out.push({
          ...base,
          rowKey: `s${seg.id}`,
          segmentId: seg.id,
          siloId: seg.silo_id,
          siloName: siloNameById(seg.silo_id),
          cementKg: Math.round(Number(seg.cement_kg || 0) * 10) / 10,
          writeOffAt: seg.created_at,
          segmentKind: seg.kind,
        });
      }
      continue;
    }

    const siloId = Number(row.cement_write_off_silo_id);
    if (opts.fromSiloId != null && siloId !== opts.fromSiloId) continue;
    out.push({
      ...base,
      rowKey: `m${mixerId}`,
      segmentId: null,
      siloId,
      siloName: siloNameById(siloId),
      cementKg: Math.round(Number(row.cement_write_off_kg || 0) * 10) / 10,
      writeOffAt: row.cement_write_off_at ? String(row.cement_write_off_at) : null,
      segmentKind: null,
    });
  }

  return out;
}

/** Список рейсов со списанием за день (для выбора). */
export async function GET(request: NextRequest) {
  const auth = await authAdmin(request);
  if (auth.error) return auth.error;

  try {
    const dateParam = request.nextUrl.searchParams.get('date');
    const dateIso = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)
      ? dateParam
      : moscowDateStr();

    const fromRaw = request.nextUrl.searchParams.get('fromSilo');
    const fromSiloId = fromRaw && [1, 2, 3].includes(Number(fromRaw))
      ? Number(fromRaw)
      : null;

    const orderRaw = request.nextUrl.searchParams.get('orderId');
    const orderId = orderRaw && Number(orderRaw) > 0 ? Number(orderRaw) : null;

    const trips = await loadTrips({ dateIso, fromSiloId, orderId });
    const totalKg = Math.round(trips.reduce((s, t) => s + t.cementKg, 0) * 10) / 10;

    return NextResponse.json({
      date: dateIso,
      fromSiloId,
      orderId,
      tripCount: trips.length,
      totalKg,
      trips,
    });
  } catch (err: any) {
    console.error('cement-transfer GET:', err);
    return NextResponse.json({ error: err.message || 'Ошибка' }, { status: 500 });
  }
}

type TransferResult = {
  id: number;
  orderId: number;
  fromSiloId: number;
  toSiloId: number;
  cementKg: number;
  ok: boolean;
  error?: string;
};

type RpcTransferRow = {
  ok: boolean;
  error_text: string | null;
  order_id: number | string | null;
  from_silo_id: number | string | null;
  to_silo_id: number | string | null;
  cement_kg: number | string | null;
  from_old_tons: number | string | null;
  from_new_tons: number | string | null;
  to_old_tons: number | string | null;
  to_new_tons: number | string | null;
};

function isMissingRpc(err: { message?: string; code?: string } | null): boolean {
  const msg = String(err?.message || '').toLowerCase();
  const code = String(err?.code || '');
  return code === '42883'
    || code === 'PGRST202'
    || msg.includes('warehouse_cement_transfer_silo')
    || msg.includes('could not find the function');
}

/** Перенос одного сегмента списания (split по силосам). */
async function transferOneSegment(
  mixerId: number,
  segmentId: number,
  toSiloId: number,
  actorName: string,
): Promise<TransferResult> {
  const { data: mixer } = await supabase
    .from('order_mixers')
    .select('id, order_id')
    .eq('id', mixerId)
    .maybeSingle();
  if (!mixer) {
    return {
      id: mixerId,
      orderId: 0,
      fromSiloId: 0,
      toSiloId,
      cementKg: 0,
      ok: false,
      error: 'Рейс не найден',
    };
  }

  const orderId = Number(mixer.order_id);
  const { data: seg, error: segError } = await supabase
    .from('order_mixer_cement_segments')
    .select('id, order_mixer_id, silo_id, cement_kg')
    .eq('id', segmentId)
    .eq('order_mixer_id', mixerId)
    .maybeSingle();

  if (segError || !seg) {
    return {
      id: mixerId,
      orderId,
      fromSiloId: 0,
      toSiloId,
      cementKg: 0,
      ok: false,
      error: 'Сегмент списания не найден',
    };
  }

  const fromSiloId = Number(seg.silo_id);
  const cementKg = Math.round(Number(seg.cement_kg || 0) * 10) / 10;
  const tons = cementKg / 1000;

  if (![1, 2, 3].includes(fromSiloId) || !(cementKg > 0)) {
    return {
      id: mixerId,
      orderId,
      fromSiloId,
      toSiloId,
      cementKg,
      ok: false,
      error: 'Некорректный сегмент',
    };
  }
  if (fromSiloId === toSiloId) {
    return {
      id: mixerId,
      orderId,
      fromSiloId,
      toSiloId,
      cementKg,
      ok: false,
      error: 'Уже на целевом силосе',
    };
  }

  const { data: addRows, error: addError } = await supabase.rpc('warehouse_silo_adjust', {
    p_silo_id: fromSiloId,
    p_delta_tons: tons,
  });
  if (addError) {
    return {
      id: mixerId,
      orderId,
      fromSiloId,
      toSiloId,
      cementKg,
      ok: false,
      error: `Возврат на ${siloNameById(fromSiloId)}: ${addError.message}`,
    };
  }

  const { data: subRows, error: subError } = await supabase.rpc('warehouse_silo_adjust', {
    p_silo_id: toSiloId,
    p_delta_tons: -tons,
  });
  if (subError) {
    await supabase.rpc('warehouse_silo_adjust', {
      p_silo_id: fromSiloId,
      p_delta_tons: -tons,
    });
    return {
      id: mixerId,
      orderId,
      fromSiloId,
      toSiloId,
      cementKg,
      ok: false,
      error: `Списание с ${siloNameById(toSiloId)}: ${subError.message}`,
    };
  }

  const { data: patched, error: patchError } = await supabase
    .from('order_mixer_cement_segments')
    .update({ silo_id: toSiloId })
    .eq('id', segmentId)
    .eq('silo_id', fromSiloId)
    .select('id')
    .maybeSingle();

  if (patchError || !patched) {
    await supabase.rpc('warehouse_silo_adjust', {
      p_silo_id: fromSiloId,
      p_delta_tons: -tons,
    });
    await supabase.rpc('warehouse_silo_adjust', {
      p_silo_id: toSiloId,
      p_delta_tons: tons,
    });
    return {
      id: mixerId,
      orderId,
      fromSiloId,
      toSiloId,
      cementKg,
      ok: false,
      error: patchError?.message || 'Сегмент уже изменён',
    };
  }

  await syncMixerCementAggregate(mixerId);

  const addAdj = Array.isArray(addRows) ? addRows[0] : addRows;
  const subAdj = Array.isArray(subRows) ? subRows[0] : subRows;
  await writeTransferJournal({
    orderId,
    actorName,
    fromSiloId,
    toSiloId,
    cementKg,
    fromOldTons: Number(addAdj?.old_current ?? 0),
    fromNewTons: Number(addAdj?.new_current ?? 0),
    toOldTons: Number(subAdj?.old_current ?? 0),
    toNewTons: Number(subAdj?.new_current ?? 0),
  });
  await syncSiloLowRateAlert(supabase, fromSiloId);
  await syncSiloLowRateAlert(supabase, toSiloId);

  return {
    id: mixerId,
    orderId,
    fromSiloId,
    toSiloId,
    cementKg,
    ok: true,
  };
}

/** Запасной путь без SQL-функции (хуже по атомарности). */
async function transferOneLegacy(
  mixerId: number,
  toSiloId: number,
  actorName: string,
): Promise<TransferResult> {
  const { data: mixer, error: fetchError } = await supabase
    .from('order_mixers')
    .select('id, order_id, cement_write_off_kg, cement_write_off_silo_id')
    .eq('id', mixerId)
    .maybeSingle();

  if (fetchError || !mixer) {
    return {
      id: mixerId,
      orderId: 0,
      fromSiloId: 0,
      toSiloId,
      cementKg: 0,
      ok: false,
      error: 'Рейс не найден',
    };
  }

  const orderId = Number(mixer.order_id);
  const fromSiloId = Number(mixer.cement_write_off_silo_id);
  const cementKgRaw = Number(mixer.cement_write_off_kg);
  const cementKg = Math.round(cementKgRaw * 10) / 10;
  const tons = cementKg / 1000;

  if (![1, 2, 3].includes(fromSiloId) || !(cementKg > 0)) {
    return {
      id: mixerId,
      orderId,
      fromSiloId,
      toSiloId,
      cementKg,
      ok: false,
      error: 'Нет записанного списания цемента',
    };
  }

  if (fromSiloId === toSiloId) {
    return {
      id: mixerId,
      orderId,
      fromSiloId,
      toSiloId,
      cementKg,
      ok: false,
      error: 'Уже на целевом силосе',
    };
  }

  const { data: addRows, error: addError } = await supabase.rpc('warehouse_silo_adjust', {
    p_silo_id: fromSiloId,
    p_delta_tons: tons,
  });
  if (addError) {
    return {
      id: mixerId,
      orderId,
      fromSiloId,
      toSiloId,
      cementKg,
      ok: false,
      error: `Возврат на ${siloNameById(fromSiloId)}: ${addError.message}`,
    };
  }

  const { data: subRows, error: subError } = await supabase.rpc('warehouse_silo_adjust', {
    p_silo_id: toSiloId,
    p_delta_tons: -tons,
  });
  if (subError) {
    const { error: undoErr } = await supabase.rpc('warehouse_silo_adjust', {
      p_silo_id: fromSiloId,
      p_delta_tons: -tons,
    });
    return {
      id: mixerId,
      orderId,
      fromSiloId,
      toSiloId,
      cementKg,
      ok: false,
      error: undoErr
        ? `Списание с ${siloNameById(toSiloId)} не удалось, откат остатка тоже: ${undoErr.message}`
        : `Списание с ${siloNameById(toSiloId)}: ${subError.message}`,
    };
  }

  // CAS только по силосу: eq по float-кг в PostgREST ненадёжен.
  const { data: patched, error: patchError } = await supabase
    .from('order_mixers')
    .update({ cement_write_off_silo_id: toSiloId })
    .eq('id', mixerId)
    .eq('cement_write_off_silo_id', fromSiloId)
    .not('cement_write_off_kg', 'is', null)
    .select('id')
    .maybeSingle();

  if (patchError || !patched) {
    const { error: undoFrom } = await supabase.rpc('warehouse_silo_adjust', {
      p_silo_id: fromSiloId,
      p_delta_tons: -tons,
    });
    const { error: undoTo } = await supabase.rpc('warehouse_silo_adjust', {
      p_silo_id: toSiloId,
      p_delta_tons: tons,
    });
    const undoNote = (undoFrom || undoTo)
      ? ` (откат остатков: ${[undoFrom?.message, undoTo?.message].filter(Boolean).join('; ')})`
      : '';
    return {
      id: mixerId,
      orderId,
      fromSiloId,
      toSiloId,
      cementKg,
      ok: false,
      error: (patchError?.message || 'Рейс уже изменён другим действием') + undoNote,
    };
  }

  const addAdj = Array.isArray(addRows) ? addRows[0] : addRows;
  const subAdj = Array.isArray(subRows) ? subRows[0] : subRows;
  await writeTransferJournal({
    orderId,
    actorName,
    fromSiloId,
    toSiloId,
    cementKg,
    fromOldTons: Number(addAdj?.old_current ?? 0),
    fromNewTons: Number(addAdj?.new_current ?? 0),
    toOldTons: Number(subAdj?.old_current ?? 0),
    toNewTons: Number(subAdj?.new_current ?? 0),
  });
  await syncSiloLowRateAlert(supabase, fromSiloId);
  await syncSiloLowRateAlert(supabase, toSiloId);

  return {
    id: mixerId,
    orderId,
    fromSiloId,
    toSiloId,
    cementKg,
    ok: true,
  };
}

async function writeTransferJournal(opts: {
  orderId: number;
  actorName: string;
  fromSiloId: number;
  toSiloId: number;
  cementKg: number;
  fromOldTons: number;
  fromNewTons: number;
  toOldTons: number;
  toNewTons: number;
}) {
  const journalLabel = formatSiloCementJournalActor({
    kind: 'transfer',
    orderId: opts.orderId,
    actorName: opts.actorName,
    fromSiloId: opts.fromSiloId,
    toSiloId: opts.toSiloId,
  });

  const { error: histError } = await supabase.from('warehouse_operations').insert([
    {
      operation_type: 'add',
      item_type: siloNameById(opts.fromSiloId),
      amount: opts.cementKg,
      old_value: Math.round(opts.fromOldTons * 1000 * 10) / 10,
      new_value: Math.round(opts.fromNewTons * 1000 * 10) / 10,
      unit: 'кг',
      user_name: journalLabel,
    },
    {
      operation_type: 'subtract',
      item_type: siloNameById(opts.toSiloId),
      amount: opts.cementKg,
      old_value: Math.round(opts.toOldTons * 1000 * 10) / 10,
      new_value: Math.round(opts.toNewTons * 1000 * 10) / 10,
      unit: 'кг',
      user_name: journalLabel,
    },
  ]);
  if (histError) {
    console.error('Не удалось записать журнал корректировки силоса:', histError);
  }
}

async function transferOne(
  mixerId: number,
  toSiloId: number,
  actorName: string,
  segmentId?: number | null,
): Promise<TransferResult> {
  if (segmentId != null && Number(segmentId) > 0) {
    return transferOneSegment(mixerId, Number(segmentId), toSiloId, actorName);
  }

  const segments = await listCementSegments(mixerId);
  if (segments.length > 1) {
    return {
      id: mixerId,
      orderId: 0,
      fromSiloId: 0,
      toSiloId,
      cementKg: 0,
      ok: false,
      error: 'У рейса несколько сегментов списания — выбери конкретный сегмент в списке',
    };
  }
  if (segments.length === 1) {
    return transferOneSegment(mixerId, segments[0].id, toSiloId, actorName);
  }

  const { data, error } = await supabase.rpc('warehouse_cement_transfer_silo', {
    p_mixer_id: mixerId,
    p_to_silo_id: toSiloId,
  });

  if (error) {
    if (isMissingRpc(error)) {
      console.warn('warehouse_cement_transfer_silo отсутствует — legacy-перенос');
      return transferOneLegacy(mixerId, toSiloId, actorName);
    }
    return {
      id: mixerId,
      orderId: 0,
      fromSiloId: 0,
      toSiloId,
      cementKg: 0,
      ok: false,
      error: error.message,
    };
  }

  const row = (Array.isArray(data) ? data[0] : data) as RpcTransferRow | null;
  if (!row) {
    return {
      id: mixerId,
      orderId: 0,
      fromSiloId: 0,
      toSiloId,
      cementKg: 0,
      ok: false,
      error: 'Пустой ответ переноса',
    };
  }

  const orderId = Number(row.order_id || 0);
  const fromSiloId = Number(row.from_silo_id || 0);
  const cementKg = Math.round(Number(row.cement_kg || 0) * 10) / 10;

  if (!row.ok) {
    return {
      id: mixerId,
      orderId,
      fromSiloId,
      toSiloId,
      cementKg,
      ok: false,
      error: row.error_text || 'Не удалось перенести',
    };
  }

  const toId = Number(row.to_silo_id || toSiloId);
  await writeTransferJournal({
    orderId,
    actorName,
    fromSiloId,
    toSiloId: toId,
    cementKg,
    fromOldTons: Number(row.from_old_tons ?? 0),
    fromNewTons: Number(row.from_new_tons ?? 0),
    toOldTons: Number(row.to_old_tons ?? 0),
    toNewTons: Number(row.to_new_tons ?? 0),
  });
  await syncSiloLowRateAlert(supabase, fromSiloId);
  await syncSiloLowRateAlert(supabase, toId);

  return {
    id: mixerId,
    orderId,
    fromSiloId,
    toSiloId: toId,
    cementKg,
    ok: true,
  };
}

/** Перенести списание выбранных рейсов на другой силос. */
export async function POST(request: NextRequest) {
  const auth = await authAdmin(request);
  if (auth.error) return auth.error;

  try {
    const body = await request.json().catch(() => ({}));
    const toSiloId = Number(body?.toSiloId);
    if (![1, 2, 3].includes(toSiloId)) {
      return NextResponse.json({ error: 'Укажи целевой силос (1–3)' }, { status: 400 });
    }

    type TransferItem = { mixerId: number; segmentId: number | null };
    const items: TransferItem[] = [];
    const seen = new Set<string>();

    const rawItems: unknown[] = Array.isArray(body?.items) ? body.items : [];
    for (const raw of rawItems) {
      const mixerId = Number((raw as any)?.mixerId);
      const segmentRaw = (raw as any)?.segmentId;
      const segmentId = segmentRaw != null && Number(segmentRaw) > 0 ? Number(segmentRaw) : null;
      if (!Number.isFinite(mixerId) || mixerId <= 0) continue;
      const key = `${mixerId}:${segmentId ?? 'm'}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({ mixerId, segmentId });
    }

    // Обратная совместимость: mixerIds без сегментов
    if (items.length === 0 && Array.isArray(body?.mixerIds)) {
      for (const x of body.mixerIds) {
        const n = Number(x);
        if (!Number.isFinite(n) || n <= 0 || seen.has(`${n}:m`)) continue;
        seen.add(`${n}:m`);
        items.push({ mixerId: n, segmentId: null });
      }
    }

    if (items.length === 0) {
      return NextResponse.json({ error: 'Выбери хотя бы один рейс' }, { status: 400 });
    }
    if (items.length > 100) {
      return NextResponse.json({ error: 'Слишком много рейсов за раз (макс. 100)' }, { status: 400 });
    }

    const actorName = auth.user.full_name || 'Администратор';
    const results: TransferResult[] = [];

    for (const item of items) {
      results.push(await transferOne(item.mixerId, toSiloId, actorName, item.segmentId));
    }

    const ok = results.filter((r) => r.ok);
    const failed = results.filter((r) => !r.ok);
    const totalKg = Math.round(ok.reduce((s, r) => s + r.cementKg, 0) * 10) / 10;

    return NextResponse.json({
      success: failed.length === 0,
      toSiloId,
      toSiloName: siloNameById(toSiloId),
      moved: ok.length,
      failed: failed.length,
      totalKg,
      results,
      errors: failed.map((r) => `#${r.orderId || r.id}: ${r.error}`),
    });
  } catch (err: any) {
    console.error('cement-transfer POST:', err);
    return NextResponse.json({ error: err.message || 'Ошибка' }, { status: 500 });
  }
}
