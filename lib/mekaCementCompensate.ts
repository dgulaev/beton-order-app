/**
 * Компенсация разницы MEKA − склад по силосам после загрузки отчёта MEKA.
 * Сопоставление партий по марке + времени — приближённое.
 */
import { supabaseAdmin as supabase } from '@/lib/supabaseAdmin';
import { SILO_SPEC, siloNameById, syncSiloLowRateAlert } from '@/lib/siloConfig';

const NOISE_KG = 0.5;
const MATCH_WINDOW_MIN = 180; // ±3 часа

export type CompensateSiloRow = {
  siloId: number;
  kg: number;
  direction: 'writeoff' | 'return';
};

export type CompensateResult = {
  ok: boolean;
  skipped: boolean;
  status: 'applied' | 'skipped_noise' | 'skipped_no_warehouse' | 'already_done' | 'error';
  reportDate: string;
  mekaKg: number;
  warehouseKg: number;
  deltaKg: number;
  bySilo: CompensateSiloRow[];
  message?: string;
};

type MekaBatch = {
  gradeKey: string;
  minutes: number;
  cementKg: number;
};

type TripWriteoff = {
  id: number;
  gradeKey: string;
  minutes: number;
  totalKg: number;
  /** доли по силосам (сумма = totalKg) */
  bySilo: Map<number, number>;
  used: boolean;
};

function normalizeGradeKey(value: string): string {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/Ё/g, 'Е')
    .replace(/\s+/g, '')
    .replace(/M(?=\d)/g, 'М');
}

function parseTimeMinutes(time: string | null | undefined): number | null {
  const m = String(time || '').trim().match(/^(\d{1,2})\s*:\s*(\d{2})/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h < 0 || h > 23) return null;
  return h * 60 + min;
}

function moscowMinutesFromIso(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Moscow',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return hour * 60 + minute;
}

function moscowDayBounds(dateKey: string): { start: string; end: string } {
  const start = new Date(`${dateKey}T00:00:00+03:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

function roundKg(kg: number): number {
  return Math.round(kg * 10) / 10;
}

function parseMekaBatches(rawData: unknown): { batches: MekaBatch[]; totalKg: number } {
  const rows = Array.isArray(rawData) ? rawData : [];
  const batches: MekaBatch[] = [];
  let totalKg = 0;
  for (const row of rows) {
    const recipe = String((row as any)?.recipe || '').trim();
    if (!recipe || recipe === 'Неизвестно' || recipe.includes('ИТОГО')) continue;
    const cementKg = Number((row as any)?.cement || 0);
    if (!(cementKg > 0)) continue;
    const minutes = parseTimeMinutes((row as any)?.time);
    if (minutes == null) continue;
    const gradeKey = normalizeGradeKey(recipe);
    if (!gradeKey) continue;
    batches.push({ gradeKey, minutes, cementKg });
    totalKg += cementKg;
  }
  return { batches, totalKg: roundKg(totalKg) };
}

async function loadDayTrips(dateKey: string): Promise<{
  trips: TripWriteoff[];
  warehouseKg: number;
  bySiloShare: Map<number, number>;
}> {
  const { start, end } = moscowDayBounds(dateKey);
  const { data, error } = await supabase
    .from('order_mixers')
    .select(`
      id,
      cement_write_off_kg,
      cement_write_off_silo_id,
      cement_write_off_at,
      orders!inner ( grade )
    `)
    .not('cement_write_off_kg', 'is', null)
    .gte('cement_write_off_at', start)
    .lt('cement_write_off_at', end);

  if (error) throw error;

  const trips: TripWriteoff[] = [];
  const bySiloShare = new Map<number, number>();
  for (const spec of SILO_SPEC) bySiloShare.set(spec.silo_id, 0);

  const mixerIds = (data || [])
    .map((row) => Number(row.id))
    .filter((id) => Number.isFinite(id) && id > 0);

  type SegRow = { silo_id: number; cement_kg: number };
  const segmentsByMixer = new Map<number, SegRow[]>();
  if (mixerIds.length > 0) {
    const { data: segRows, error: segError } = await supabase
      .from('order_mixer_cement_segments')
      .select('order_mixer_id, silo_id, cement_kg')
      .in('order_mixer_id', mixerIds);
    if (!segError && segRows) {
      for (const row of segRows) {
        const mid = Number(row.order_mixer_id);
        const list = segmentsByMixer.get(mid) || [];
        list.push({
          silo_id: Number(row.silo_id),
          cement_kg: Number(row.cement_kg),
        });
        segmentsByMixer.set(mid, list);
      }
    }
  }

  let warehouseKg = 0;

  for (const row of data || []) {
    const id = Number(row.id);
    const totalKg = roundKg(Number(row.cement_write_off_kg || 0));
    if (!(totalKg > 0)) continue;

    const gradeKey = normalizeGradeKey(String((row as any).orders?.grade || ''));
    const minutes = moscowMinutesFromIso(row.cement_write_off_at as string) ?? 12 * 60;
    const bySilo = new Map<number, number>();

    const segments = segmentsByMixer.get(id) || [];
    if (segments.length > 0) {
      for (const seg of segments) {
        const kg = roundKg(Number(seg.cement_kg || 0));
        if (!(kg > 0) || ![1, 2, 3].includes(seg.silo_id)) continue;
        bySilo.set(seg.silo_id, (bySilo.get(seg.silo_id) || 0) + kg);
      }
    } else {
      const siloId = Number(row.cement_write_off_silo_id);
      if ([1, 2, 3].includes(siloId)) bySilo.set(siloId, totalKg);
    }

    if (bySilo.size === 0) continue;

    // Нормируем сумму долей к totalKg
    const segSum = Array.from(bySilo.values()).reduce((s, v) => s + v, 0);
    if (segSum > 0 && Math.abs(segSum - totalKg) > 0.2) {
      for (const [sid, kg] of bySilo) {
        bySilo.set(sid, roundKg((kg / segSum) * totalKg));
      }
    }

    for (const [sid, kg] of bySilo) {
      bySiloShare.set(sid, (bySiloShare.get(sid) || 0) + kg);
    }
    warehouseKg += totalKg;
    trips.push({ id, gradeKey, minutes, totalKg, bySilo, used: false });
  }

  return { trips, warehouseKg: roundKg(warehouseKg), bySiloShare };
}

function addToSiloDelta(map: Map<number, number>, siloId: number, deltaKg: number) {
  if (![1, 2, 3].includes(siloId) || !Number.isFinite(deltaKg) || deltaKg === 0) return;
  map.set(siloId, (map.get(siloId) || 0) + deltaKg);
}

function distributeTripDelta(
  map: Map<number, number>,
  trip: TripWriteoff,
  deltaKg: number,
) {
  const entries = Array.from(trip.bySilo.entries()).filter(([, kg]) => kg > 0);
  if (entries.length === 0) return;
  const sum = entries.reduce((s, [, kg]) => s + kg, 0);
  if (!(sum > 0)) return;
  let allocated = 0;
  entries.forEach(([siloId, kg], idx) => {
    const part = idx === entries.length - 1
      ? roundKg(deltaKg - allocated)
      : roundKg(deltaKg * (kg / sum));
    allocated = roundKg(allocated + part);
    addToSiloDelta(map, siloId, part);
  });
}

function distributeByShare(
  map: Map<number, number>,
  share: Map<number, number>,
  deltaKg: number,
) {
  const entries = Array.from(share.entries()).filter(([, kg]) => kg > 0);
  const sum = entries.reduce((s, [, kg]) => s + kg, 0);
  if (!(sum > 0)) return false;
  let allocated = 0;
  entries.forEach(([siloId, kg], idx) => {
    const part = idx === entries.length - 1
      ? roundKg(deltaKg - allocated)
      : roundKg(deltaKg * (kg / sum));
    allocated = roundKg(allocated + part);
    addToSiloDelta(map, siloId, part);
  });
  return true;
}

function findNearestTrip(
  trips: TripWriteoff[],
  gradeKey: string,
  minutes: number,
): TripWriteoff | null {
  let best: TripWriteoff | null = null;
  let bestDist = Infinity;
  for (const trip of trips) {
    if (trip.used || trip.gradeKey !== gradeKey) continue;
    const dist = Math.abs(trip.minutes - minutes);
    if (dist > MATCH_WINDOW_MIN) continue;
    if (dist < bestDist) {
      bestDist = dist;
      best = trip;
    }
  }
  return best;
}

function siloDeltasToRows(map: Map<number, number>): CompensateSiloRow[] {
  const rows: CompensateSiloRow[] = [];
  for (const spec of SILO_SPEC) {
    const raw = roundKg(map.get(spec.silo_id) || 0);
    if (Math.abs(raw) < 0.05) continue;
    rows.push({
      siloId: spec.silo_id,
      kg: Math.abs(raw),
      direction: raw > 0 ? 'writeoff' : 'return',
    });
  }
  return rows;
}

/** Выровнять сумму signed-дельт к targetDelta (поправка на последний силос). */
function forceSumToTarget(map: Map<number, number>, targetDelta: number) {
  const keys = Array.from(map.keys()).filter((k) => Math.abs(map.get(k) || 0) > 0.01);
  if (keys.length === 0) {
    // весь delta на силос 2 как fallback не делаем — вызывающий проверит
    return;
  }
  const sum = roundKg(keys.reduce((s, k) => s + (map.get(k) || 0), 0));
  const diff = roundKg(targetDelta - sum);
  if (Math.abs(diff) < 0.05) return;
  const last = keys[keys.length - 1];
  map.set(last, roundKg((map.get(last) || 0) + diff));
}

async function recordCompensation(opts: {
  reportDate: string;
  mekaReportId: number | null;
  mekaKg: number;
  warehouseKg: number;
  deltaKg: number;
  status: 'applied' | 'skipped_noise' | 'skipped_no_warehouse';
  bySilo: CompensateSiloRow[];
  userName: string | null;
}): Promise<boolean> {
  const { error } = await supabase.from('warehouse_meka_cement_compensations').insert({
    report_date: opts.reportDate,
    meka_report_id: opts.mekaReportId,
    meka_kg: opts.mekaKg,
    warehouse_kg: opts.warehouseKg,
    delta_kg: opts.deltaKg,
    status: opts.status,
    by_silo: opts.bySilo,
    user_name: opts.userName,
  });
  if (error) {
    if (String(error.message || '').includes('duplicate') || error.code === '23505') {
      return false;
    }
    throw error;
  }
  return true;
}

/**
 * Главный вход: вызвать после успешного INSERT meka_reports.
 * Идемпотентно по report_date.
 */
export async function compensateMekaCementDelta(opts: {
  reportDate: string;
  mekaReportId: number | null;
  rawData: unknown;
  userName?: string | null;
}): Promise<CompensateResult> {
  const reportDate = String(opts.reportDate || '').substring(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) {
    return {
      ok: false,
      skipped: true,
      status: 'error',
      reportDate,
      mekaKg: 0,
      warehouseKg: 0,
      deltaKg: 0,
      bySilo: [],
      message: 'Некорректная дата отчёта',
    };
  }

  try {
    const { data: existing } = await supabase
      .from('warehouse_meka_cement_compensations')
      .select('id, status, meka_kg, warehouse_kg, delta_kg, by_silo')
      .eq('report_date', reportDate)
      .maybeSingle();

    if (existing) {
      const prevStatus = String(existing.status || '');
      // Пропуски можно пересчитать (MEKA загрузили до рейсов / дельта была ~0).
      // applied — только через откат (удаление отчёта).
      if (prevStatus === 'skipped_no_warehouse' || prevStatus === 'skipped_noise') {
        await supabase
          .from('warehouse_meka_cement_compensations')
          .delete()
          .eq('report_date', reportDate);
      } else {
        return {
          ok: true,
          skipped: true,
          status: 'already_done',
          reportDate,
          mekaKg: Number(existing.meka_kg || 0),
          warehouseKg: Number(existing.warehouse_kg || 0),
          deltaKg: Number(existing.delta_kg || 0),
          bySilo: Array.isArray(existing.by_silo) ? existing.by_silo as CompensateSiloRow[] : [],
          message: 'Компенсация за этот день уже выполнялась',
        };
      }
    }

    const { batches, totalKg: mekaKg } = parseMekaBatches(opts.rawData);
    const { trips, warehouseKg, bySiloShare } = await loadDayTrips(reportDate);
    const deltaKg = roundKg(mekaKg - warehouseKg);

    if (Math.abs(deltaKg) < NOISE_KG) {
      await recordCompensation({
        reportDate,
        mekaReportId: opts.mekaReportId,
        mekaKg,
        warehouseKg,
        deltaKg,
        status: 'skipped_noise',
        bySilo: [],
        userName: opts.userName ?? null,
      });
      return {
        ok: true,
        skipped: true,
        status: 'skipped_noise',
        reportDate,
        mekaKg,
        warehouseKg,
        deltaKg,
        bySilo: [],
        message: 'Разница меньше порога — компенсация не нужна',
      };
    }

    const shareSum = Array.from(bySiloShare.values()).reduce((s, v) => s + v, 0);
    if (!(shareSum > 0) || trips.length === 0) {
      await recordCompensation({
        reportDate,
        mekaReportId: opts.mekaReportId,
        mekaKg,
        warehouseKg,
        deltaKg,
        status: 'skipped_no_warehouse',
        bySilo: [],
        userName: opts.userName ?? null,
      });
      return {
        ok: true,
        skipped: true,
        status: 'skipped_no_warehouse',
        reportDate,
        mekaKg,
        warehouseKg,
        deltaKg,
        bySilo: [],
        message: 'Нет складских списаний за день — компенсацию пропустили',
      };
    }

    // Дневную deltaKg разносим по силосам пропорционально весам матчинга:
    // партия MEKA → ближайший рейс той же марки → доли силосов рейса.
    // Несопоставленное — по доле складского списания дня.
    // Важно: двигаем только дневную дельту (|delta| обычно кг/десятки кг),
    // а не «meka_silo − wh_silo» целиком — иначе из шума матчинга получаются
    // ложные ±тонны на разных силосах, которые лишь в сумме дают delta.
    const weight = new Map<number, number>();
    for (const spec of SILO_SPEC) weight.set(spec.silo_id, 0);

    let matchedMekaKg = 0;
    for (const batch of batches) {
      const trip = findNearestTrip(trips, batch.gradeKey, batch.minutes);
      if (!trip) continue;
      trip.used = true;
      matchedMekaKg += batch.cementKg;
      distributeTripDelta(weight, trip, batch.cementKg);
    }

    const unmatchedMekaKg = roundKg(mekaKg - matchedMekaKg);
    if (Math.abs(unmatchedMekaKg) > 0.05) {
      distributeByShare(weight, bySiloShare, unmatchedMekaKg);
    }

    const weightSum = Array.from(weight.values()).reduce((s, v) => s + v, 0);
    const siloDelta = new Map<number, number>();
    if (weightSum > 0.05) {
      distributeByShare(siloDelta, weight, deltaKg);
    } else {
      distributeByShare(siloDelta, bySiloShare, deltaKg);
    }
    forceSumToTarget(siloDelta, deltaKg);

    let bySilo = siloDeltasToRows(siloDelta);
    if (bySilo.length === 0) {
      await recordCompensation({
        reportDate,
        mekaReportId: opts.mekaReportId,
        mekaKg,
        warehouseKg,
        deltaKg,
        status: 'skipped_no_warehouse',
        bySilo: [],
        userName: opts.userName ?? null,
      });
      return {
        ok: true,
        skipped: true,
        status: 'skipped_no_warehouse',
        reportDate,
        mekaKg,
        warehouseKg,
        deltaKg,
        bySilo: [],
        message: 'Не удалось разнести дельту по силосам',
      };
    }

    // Сначала фиксируем день (идемпотентность), потом двигаем силосы.
    // Если adjust упадёт — удаляем запись, чтобы можно было повторить.
    const inserted = await recordCompensation({
      reportDate,
      mekaReportId: opts.mekaReportId,
      mekaKg,
      warehouseKg,
      deltaKg,
      status: 'applied',
      bySilo,
      userName: opts.userName ?? null,
    });

    if (!inserted) {
      return {
        ok: true,
        skipped: true,
        status: 'already_done',
        reportDate,
        mekaKg,
        warehouseKg,
        deltaKg,
        bySilo,
        message: 'Компенсация уже была записана параллельно',
      };
    }

    const dateLabel = reportDate.split('-').reverse().join('.');
    try {
      for (const row of bySilo) {
        const signedTons = (row.direction === 'writeoff' ? -row.kg : row.kg) / 1000;
        const { data: adjRows, error: rpcError } = await supabase.rpc('warehouse_silo_adjust', {
          p_silo_id: row.siloId,
          p_delta_tons: signedTons,
        });
        if (rpcError) {
          throw new Error(`Силос ${row.siloId}: ${rpcError.message}`);
        }
        const adj = Array.isArray(adjRows) ? adjRows[0] : adjRows;
        const oldKg = Number(adj?.old_current ?? 0) * 1000;
        const newKg = Number(adj?.new_current ?? 0) * 1000;
        await supabase.from('warehouse_operations').insert({
          operation_type: row.direction === 'writeoff' ? 'subtract' : 'add',
          item_type: siloNameById(row.siloId),
          amount: row.kg,
          old_value: Math.round(oldKg * 10) / 10,
          new_value: Math.round(newKg * 10) / 10,
          unit: 'кг',
          user_name: `Компенсация MEKA · ${dateLabel} · ${siloNameById(row.siloId)}`,
        });
        await syncSiloLowRateAlert(supabase, row.siloId);

        if (row.direction === 'return') {
          const { error: savError } = await supabase.from('warehouse_cement_savings').insert({
            silo_id: row.siloId,
            amount_kg: row.kg,
            reason: 'meka_reconcile',
            balance_before_tons: Number(adj?.old_current ?? 0),
            user_name: opts.userName || 'MEKA',
          });
          if (savError) {
            console.error('meka_reconcile savings insert:', savError);
          }
        }
      }
    } catch (applyErr) {
      await supabase
        .from('warehouse_meka_cement_compensations')
        .delete()
        .eq('report_date', reportDate);
      throw applyErr;
    }

    return {
      ok: true,
      skipped: false,
      status: 'applied',
      reportDate,
      mekaKg,
      warehouseKg,
      deltaKg,
      bySilo,
    };
  } catch (err: any) {
    console.error('compensateMekaCementDelta:', err);
    return {
      ok: false,
      skipped: true,
      status: 'error',
      reportDate,
      mekaKg: 0,
      warehouseKg: 0,
      deltaKg: 0,
      bySilo: [],
      message: err?.message || 'Ошибка компенсации',
    };
  }
}

export async function getMekaCementCompensation(reportDate: string): Promise<{
  status: string;
  mekaKg: number;
  warehouseKg: number;
  deltaKg: number;
  bySilo: CompensateSiloRow[];
  createdAt: string | null;
} | null> {
  const date = String(reportDate || '').substring(0, 10);
  const { data, error } = await supabase
    .from('warehouse_meka_cement_compensations')
    .select('status, meka_kg, warehouse_kg, delta_kg, by_silo, created_at')
    .eq('report_date', date)
    .maybeSingle();

  if (error) {
    if (String(error.message || '').includes('warehouse_meka_cement_compensations')) {
      return null;
    }
    console.error('getMekaCementCompensation:', error);
    return null;
  }
  if (!data) return null;
  return {
    status: String(data.status),
    mekaKg: Number(data.meka_kg || 0),
    warehouseKg: Number(data.warehouse_kg || 0),
    deltaKg: Number(data.delta_kg || 0),
    bySilo: Array.isArray(data.by_silo) ? (data.by_silo as CompensateSiloRow[]) : [],
    createdAt: data.created_at ? String(data.created_at) : null,
  };
}

function moscowDateKeyFromIso(iso?: string | null): string {
  const d = iso ? new Date(iso) : new Date();
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(Number.isNaN(d.getTime()) ? new Date() : d);
}

/**
 * Если компенсация за день была пропущена (нет склада / шум),
 * а списания рейсов уже появились — пересчитать автоматически.
 */
export async function maybeRetrySkippedMekaCompensation(opts?: {
  reportDate?: string;
  atIso?: string | null;
}): Promise<CompensateResult | null> {
  const reportDate = (opts?.reportDate || moscowDateKeyFromIso(opts?.atIso)).substring(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) return null;

  try {
    const { data: existing } = await supabase
      .from('warehouse_meka_cement_compensations')
      .select('id, status')
      .eq('report_date', reportDate)
      .maybeSingle();

    if (!existing) return null;
    const st = String(existing.status || '');
    if (st !== 'skipped_no_warehouse' && st !== 'skipped_noise') return null;

    const { data: report } = await supabase
      .from('meka_reports')
      .select('id, raw_data')
      .eq('report_date', reportDate)
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!report) return null;

    return compensateMekaCementDelta({
      reportDate,
      mekaReportId: Number(report.id),
      rawData: report.raw_data,
      userName: 'Автоповтор после списаний',
    });
  } catch (err) {
    console.error('maybeRetrySkippedMekaCompensation:', err);
    return null;
  }
}

/**
 * Откат компенсации за дату (при удалении отчёта MEKA).
 * applied → обратные adjust + удаление meka_reconcile; запись компенсации удаляется.
 */
export async function rollbackMekaCementCompensation(opts: {
  reportDate: string;
  mekaReportId?: number | null;
}): Promise<{ ok: boolean; rolledBack: boolean; message?: string }> {
  const reportDate = String(opts.reportDate || '').substring(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) {
    return { ok: false, rolledBack: false, message: 'Некорректная дата' };
  }

  const { data: row, error } = await supabase
    .from('warehouse_meka_cement_compensations')
    .select('id, status, by_silo, meka_report_id, created_at')
    .eq('report_date', reportDate)
    .maybeSingle();

  if (error) {
    return { ok: false, rolledBack: false, message: error.message };
  }
  if (!row) {
    return { ok: true, rolledBack: false, message: 'Компенсации за день не было' };
  }

  if (
    opts.mekaReportId != null
    && row.meka_report_id != null
    && Number(row.meka_report_id) !== Number(opts.mekaReportId)
  ) {
    // Компенсация от другого отчёта за ту же дату — не трогаем
    return {
      ok: true,
      rolledBack: false,
      message: 'Компенсация привязана к другому отчёту',
    };
  }

  const status = String(row.status || '');
  const bySilo = Array.isArray(row.by_silo) ? (row.by_silo as CompensateSiloRow[]) : [];
  const dateLabel = reportDate.split('-').reverse().join('.');

  if (status === 'applied' && bySilo.length > 0) {
    for (const item of bySilo) {
      // Было writeoff (−) → вернуть (+); было return (+) → снова списать (−)
      const signedTons = (item.direction === 'writeoff' ? item.kg : -item.kg) / 1000;
      const { data: adjRows, error: rpcError } = await supabase.rpc('warehouse_silo_adjust', {
        p_silo_id: item.siloId,
        p_delta_tons: signedTons,
      });
      if (rpcError) {
        return {
          ok: false,
          rolledBack: false,
          message: `Откат силоса ${item.siloId}: ${rpcError.message}`,
        };
      }
      const adj = Array.isArray(adjRows) ? adjRows[0] : adjRows;
      await supabase.from('warehouse_operations').insert({
        operation_type: item.direction === 'writeoff' ? 'add' : 'subtract',
        item_type: siloNameById(item.siloId),
        amount: item.kg,
        old_value: Math.round(Number(adj?.old_current ?? 0) * 1000 * 10) / 10,
        new_value: Math.round(Number(adj?.new_current ?? 0) * 1000 * 10) / 10,
        unit: 'кг',
        user_name: `Откат компенсации MEKA · ${dateLabel} · ${siloNameById(item.siloId)}`,
      });
      await syncSiloLowRateAlert(supabase, item.siloId);

      if (item.direction === 'return') {
        // Удаляем экономию сверки по этому силосу/объёму за день компенсации
        const createdAt = row.created_at ? String(row.created_at) : null;
        let q = supabase
          .from('warehouse_cement_savings')
          .delete()
          .eq('reason', 'meka_reconcile')
          .eq('silo_id', item.siloId)
          .eq('amount_kg', item.kg);
        if (createdAt) {
          const t0 = new Date(createdAt).getTime();
          q = q
            .gte('created_at', new Date(t0 - 60_000).toISOString())
            .lte('created_at', new Date(t0 + 5 * 60_000).toISOString());
        }
        const { error: delSav } = await q;
        if (delSav) console.error('rollback meka_reconcile savings:', delSav);
      }
    }
  }

  const { error: delErr } = await supabase
    .from('warehouse_meka_cement_compensations')
    .delete()
    .eq('report_date', reportDate);

  if (delErr) {
    return { ok: false, rolledBack: false, message: delErr.message };
  }

  return {
    ok: true,
    rolledBack: status === 'applied',
    message: status === 'applied'
      ? 'Компенсация откачена, силосы восстановлены'
      : 'Запись пропуска компенсации удалена',
  };
}
