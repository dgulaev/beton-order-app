// Сегменты списания цемента внутри одного рейса (смена силоса mid-load + final).
import { supabaseAdmin as supabase } from '@/lib/supabaseAdmin';
import {
  calculateCementUsageKg,
  findRecipeByGrade,
} from '@/lib/recipeAdditives';
import { maybeRetrySkippedMekaCompensation } from '@/lib/mekaCementCompensate';
import {
  formatSiloCementJournalActor,
  siloNameById,
  syncSiloLowRateAlert,
  type SiloCementJournalKind,
} from '@/lib/siloConfig';

const VOLUME_EPSILON = 0.01;

export type CementSegmentKind = 'mid_load' | 'final';

export type CementSegment = {
  id: number;
  order_mixer_id: number;
  silo_id: number;
  volume_m3: number;
  cement_kg: number;
  kind: CementSegmentKind;
  created_at: string;
};

function roundKg(kg: number): number {
  return Math.round(kg * 10) / 10;
}

function roundM3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

export async function listCementSegments(orderMixerId: number): Promise<CementSegment[]> {
  const { data, error } = await supabase
    .from('order_mixer_cement_segments')
    .select('id, order_mixer_id, silo_id, volume_m3, cement_kg, kind, created_at')
    .eq('order_mixer_id', orderMixerId)
    .order('created_at', { ascending: true });

  if (error) {
    // Таблица ещё не применена — работаем как без сегментов
    if (String(error.message || '').includes('order_mixer_cement_segments')) {
      return [];
    }
    console.error('listCementSegments:', error);
    return [];
  }

  return (data || []).map((row) => ({
    id: Number(row.id),
    order_mixer_id: Number(row.order_mixer_id),
    silo_id: Number(row.silo_id),
    volume_m3: Number(row.volume_m3),
    cement_kg: Number(row.cement_kg),
    kind: row.kind as CementSegmentKind,
    created_at: String(row.created_at),
  }));
}

export function sumSegmentVolumeM3(segments: CementSegment[]): number {
  return segments.reduce((sum, s) => sum + Number(s.volume_m3 || 0), 0);
}

export function sumSegmentCementKg(segments: CementSegment[]): number {
  return roundKg(segments.reduce((sum, s) => sum + Number(s.cement_kg || 0), 0));
}

export function hasFinalCementSegment(segments: CementSegment[]): boolean {
  return segments.some((s) => s.kind === 'final');
}

export async function syncMixerCementAggregate(orderMixerId: number): Promise<void> {
  const segments = await listCementSegments(orderMixerId);
  if (segments.length === 0) {
    await supabase
      .from('order_mixers')
      .update({
        cement_write_off_silo_id: null,
        cement_write_off_kg: null,
        cement_write_off_at: null,
      })
      .eq('id', orderMixerId);
    return;
  }

  const last = segments[segments.length - 1];
  await supabase
    .from('order_mixers')
    .update({
      cement_write_off_silo_id: last.silo_id,
      cement_write_off_kg: sumSegmentCementKg(segments),
      cement_write_off_at: last.created_at,
    })
    .eq('id', orderMixerId);
}

export type WriteCementSegmentResult =
  | {
      ok: true;
      segmentId: number | null;
      siloId: number;
      /** Сколько м³ реально списано этим вызовом (дельта) */
      volumeM3: number;
      /** Для mid_load: итого в миксере, которое ввёл оператор */
      totalInMixerM3?: number;
      cementKg: number;
      remainingM3: number;
      /** mid_load: объём не вырос с прошлого переключения — только смена силоса */
      skipped?: boolean;
    }
  | { ok: false; error: string };

/**
 * Списать сегмент цемента с силоса и записать в order_mixer_cement_segments.
 *
 * mid_load: volumeM3 = ИТОГО уже в миксере перед переключением (не дельта).
 *   Списывается только прирост относительно уже учтённых сегментов.
 * final: volumeM3 = остаток рейса (дельта), как передаёт вызывающий код.
 */
export async function writeCementSegment(opts: {
  orderMixerId: number;
  orderId: number;
  siloId: number;
  volumeM3: number;
  tripVolumeM3: number;
  grade: string | null | undefined;
  kind: CementSegmentKind;
  operatorName?: string | null;
  actorName?: string | null;
}): Promise<WriteCementSegmentResult> {
  const siloId = Number(opts.siloId);
  const inputM3 = roundM3(Number(opts.volumeM3));
  const tripVolumeM3 = Number(opts.tripVolumeM3);

  if (![1, 2, 3].includes(siloId)) {
    return { ok: false, error: 'Некорректный силос' };
  }
  if (!(inputM3 > 0)) {
    return { ok: false, error: 'Объём должен быть больше 0' };
  }
  if (!(tripVolumeM3 > 0)) {
    return { ok: false, error: 'У рейса нет объёма' };
  }

  const segments = await listCementSegments(opts.orderMixerId);
  if (opts.kind === 'final' && hasFinalCementSegment(segments)) {
    return { ok: false, error: 'Финальное списание уже записано' };
  }

  const used = roundM3(sumSegmentVolumeM3(segments));
  let writeM3 = inputM3;
  let totalInMixerM3: number | undefined;

  if (opts.kind === 'mid_load') {
    // Оператор вводит общий объём в миксере «сейчас», не долив с прошлого переключения
    totalInMixerM3 = inputM3;
    if (inputM3 > tripVolumeM3 + VOLUME_EPSILON) {
      return {
        ok: false,
        error: `В миксере не может быть больше плана рейса (${tripVolumeM3} м³)`,
      };
    }
    if (inputM3 + VOLUME_EPSILON < used) {
      return {
        ok: false,
        error: `Уже учтено ${used} м³ при прошлых переключениях. Нельзя указать меньше`,
      };
    }
    writeM3 = roundM3(inputM3 - used);
    if (writeM3 <= VOLUME_EPSILON) {
      return {
        ok: true,
        segmentId: null,
        siloId,
        volumeM3: 0,
        totalInMixerM3,
        cementKg: 0,
        remainingM3: roundM3(Math.max(0, tripVolumeM3 - used)),
        skipped: true,
      };
    }
  } else {
    const remaining = roundM3(tripVolumeM3 - used);
    if (writeM3 > remaining + VOLUME_EPSILON) {
      return {
        ok: false,
        error: `Уже учтено ${used} м³ из ${tripVolumeM3}. Можно списать ещё не больше ${Math.max(0, remaining)} м³`,
      };
    }
  }

  const remainingAfter = roundM3(Math.max(0, tripVolumeM3 - used - writeM3));

  const { data: recipes, error: recipesError } = await supabase
    .from('recipes')
    .select('code, name, type, cement, additive, additive2');
  if (recipesError) {
    return { ok: false, error: `Не удалось загрузить рецепты: ${recipesError.message}` };
  }

  const recipe = findRecipeByGrade(recipes || [], opts.grade);
  const cementKg = roundKg(calculateCementUsageKg(recipe, writeM3));
  if (!(cementKg > 0)) {
    return { ok: false, error: 'Не удалось рассчитать цемент по рецепту марки' };
  }

  const tons = cementKg / 1000;
  const { data: adjRows, error: rpcError } = await supabase.rpc('warehouse_silo_adjust', {
    p_silo_id: siloId,
    p_delta_tons: -tons,
  });
  if (rpcError) {
    return { ok: false, error: `Списание с силоса: ${rpcError.message}` };
  }

  const now = new Date().toISOString();
  const { data: inserted, error: insertError } = await supabase
    .from('order_mixer_cement_segments')
    .insert({
      order_mixer_id: opts.orderMixerId,
      silo_id: siloId,
      volume_m3: writeM3,
      cement_kg: cementKg,
      kind: opts.kind,
      created_at: now,
    })
    .select('id')
    .maybeSingle();

  if (insertError || !inserted) {
    await supabase.rpc('warehouse_silo_adjust', {
      p_silo_id: siloId,
      p_delta_tons: tons,
    });
    const msg = insertError?.message || 'не удалось сохранить сегмент';
    if (String(msg).includes('order_mixer_cement_segments')) {
      return {
        ok: false,
        error: 'Таблица сегментов ещё не применена в БД (scripts/warehouse-cement-segments.sql)',
      };
    }
    return { ok: false, error: msg };
  }

  await syncMixerCementAggregate(opts.orderMixerId);

  const adj = Array.isArray(adjRows) ? adjRows[0] : adjRows;
  const oldKg = Number(adj?.old_current ?? 0) * 1000;
  const newKg = Number(adj?.new_current ?? 0) * 1000;
  const journalKind: SiloCementJournalKind =
    opts.kind === 'mid_load' ? 'silo_switch' : 'auto_writeoff';

  const { error: histError } = await supabase.from('warehouse_operations').insert({
    operation_type: 'subtract',
    item_type: siloNameById(siloId),
    amount: cementKg,
    old_value: Math.round(oldKg * 10) / 10,
    new_value: Math.round(newKg * 10) / 10,
    unit: 'кг',
    user_name: formatSiloCementJournalActor({
      kind: journalKind,
      orderId: opts.orderId,
      operatorName: opts.operatorName,
      actorName: opts.actorName,
      volumeM3: writeM3,
    }),
  });
  if (histError) console.error('writeCementSegment history:', histError);
  await syncSiloLowRateAlert(supabase, siloId);

  // Если MEKA загрузили раньше рейсов — день был skipped; после списания пересчитаем
  void maybeRetrySkippedMekaCompensation({ atIso: now }).catch((err) => {
    console.error('maybeRetrySkippedMekaCompensation after segment:', err);
  });

  return {
    ok: true,
    segmentId: Number(inserted.id),
    siloId,
    volumeM3: writeM3,
    totalInMixerM3,
    cementKg,
    remainingM3: remainingAfter,
  };
}

export type RefundCementResult =
  | {
      ok: true;
      returnedKg: number;
      bySilo: { siloId: number; kg: number }[];
    }
  | { ok: false; error: string };

/**
 * Вернуть все сегменты рейса (или legacy-поля cement_write_off_*).
 * Используется при откате в «Загрузка» и при удалении рейса.
 */
export async function refundAllCementWriteoffs(opts: {
  orderMixerId: number;
  orderId: number;
  /** Legacy fallback, если сегментов нет */
  legacyKg?: number | null;
  legacySiloId?: number | null;
  operatorName?: string | null;
  actorName?: string | null;
  journalKind: 'rollback' | 'delete_return';
}): Promise<RefundCementResult> {
  // CAS: сначала забираем сегменты (delete+select). Второй параллельный
  // refund получит пустой список и не вернёт цемент дважды.
  const { data: claimedRows, error: claimError } = await supabase
    .from('order_mixer_cement_segments')
    .delete()
    .eq('order_mixer_id', opts.orderMixerId)
    .select('id, silo_id, volume_m3, cement_kg, kind, created_at');

  if (claimError) {
    if (!String(claimError.message || '').includes('order_mixer_cement_segments')) {
      return { ok: false, error: claimError.message };
    }
    // таблицы нет — уйдём в legacy ниже
  }

  const claimed = (claimedRows || []).map((row) => ({
    id: Number(row.id),
    order_mixer_id: opts.orderMixerId,
    silo_id: Number(row.silo_id),
    volume_m3: Number(row.volume_m3),
    cement_kg: Number(row.cement_kg),
    kind: row.kind as CementSegmentKind,
    created_at: String(row.created_at),
  }));

  if (claimed.length > 0) {
    await supabase
      .from('order_mixers')
      .update({
        cement_write_off_silo_id: null,
        cement_write_off_kg: null,
        cement_write_off_at: null,
      })
      .eq('id', opts.orderMixerId);

    const bySiloMap = new Map<number, number>();
    for (const seg of claimed) {
      bySiloMap.set(seg.silo_id, (bySiloMap.get(seg.silo_id) || 0) + Number(seg.cement_kg || 0));
    }

    const bySilo: { siloId: number; kg: number }[] = [];
    for (const [siloId, kgRaw] of bySiloMap) {
      const kg = roundKg(kgRaw);
      if (!(kg > 0)) continue;
      const { data: adjRows, error: rpcError } = await supabase.rpc('warehouse_silo_adjust', {
        p_silo_id: siloId,
        p_delta_tons: kg / 1000,
      });
      if (rpcError) {
        // Откатываем уже возвращённые силосы и восстанавливаем сегменты
        for (const done of bySilo) {
          await supabase.rpc('warehouse_silo_adjust', {
            p_silo_id: done.siloId,
            p_delta_tons: -done.kg / 1000,
          });
        }
        await supabase.from('order_mixer_cement_segments').insert(
          claimed.map((s) => ({
            order_mixer_id: s.order_mixer_id,
            silo_id: s.silo_id,
            volume_m3: s.volume_m3,
            cement_kg: s.cement_kg,
            kind: s.kind,
            created_at: s.created_at,
          })),
        );
        await syncMixerCementAggregate(opts.orderMixerId);
        return { ok: false, error: `Возврат на ${siloNameById(siloId)}: ${rpcError.message}` };
      }
      bySilo.push({ siloId, kg });
      const adj = Array.isArray(adjRows) ? adjRows[0] : adjRows;
      const oldKg = Number(adj?.old_current ?? 0) * 1000;
      const newKg = Number(adj?.new_current ?? 0) * 1000;
      await supabase.from('warehouse_operations').insert({
        operation_type: 'add',
        item_type: siloNameById(siloId),
        amount: kg,
        old_value: Math.round(oldKg * 10) / 10,
        new_value: Math.round(newKg * 10) / 10,
        unit: 'кг',
        user_name: formatSiloCementJournalActor({
          kind: opts.journalKind,
          orderId: opts.orderId,
          operatorName: opts.operatorName,
          actorName: opts.actorName,
        }),
      });
      await syncSiloLowRateAlert(supabase, siloId);
    }

    return {
      ok: true,
      returnedKg: roundKg(bySilo.reduce((s, x) => s + x.kg, 0)),
      bySilo,
    };
  }

  // Legacy: одно поле на рейсе
  const kg = Number(opts.legacyKg);
  const siloId = Number(opts.legacySiloId);
  if (!(kg > 0) || ![1, 2, 3].includes(siloId)) {
    return { ok: true, returnedKg: 0, bySilo: [] };
  }

  const writeOffAtClaim = await supabase
    .from('order_mixers')
    .update({
      cement_write_off_silo_id: null,
      cement_write_off_kg: null,
      cement_write_off_at: null,
    })
    .eq('id', opts.orderMixerId)
    .not('cement_write_off_kg', 'is', null)
    .select('id')
    .maybeSingle();

  if (writeOffAtClaim.error) {
    return { ok: false, error: writeOffAtClaim.error.message };
  }
  if (!writeOffAtClaim.data) {
    return { ok: true, returnedKg: 0, bySilo: [] };
  }

  const { data: adjRows, error: rpcError } = await supabase.rpc('warehouse_silo_adjust', {
    p_silo_id: siloId,
    p_delta_tons: kg / 1000,
  });
  if (rpcError) {
    await supabase
      .from('order_mixers')
      .update({
        cement_write_off_silo_id: siloId,
        cement_write_off_kg: kg,
      })
      .eq('id', opts.orderMixerId);
    return { ok: false, error: rpcError.message };
  }

  const adj = Array.isArray(adjRows) ? adjRows[0] : adjRows;
  const oldKg = Number(adj?.old_current ?? 0) * 1000;
  const newKg = Number(adj?.new_current ?? 0) * 1000;
  const returnedKg = roundKg(kg);
  await supabase.from('warehouse_operations').insert({
    operation_type: 'add',
    item_type: siloNameById(siloId),
    amount: returnedKg,
    old_value: Math.round(oldKg * 10) / 10,
    new_value: Math.round(newKg * 10) / 10,
    unit: 'кг',
    user_name: formatSiloCementJournalActor({
      kind: opts.journalKind,
      orderId: opts.orderId,
      operatorName: opts.operatorName,
      actorName: opts.actorName,
    }),
  });
  await syncSiloLowRateAlert(supabase, siloId);

  return { ok: true, returnedKg, bySilo: [{ siloId, kg: returnedKg }] };
}
