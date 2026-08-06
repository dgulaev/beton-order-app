/** Сверка заправок Benza ↔ СКАУТ (окно по времени + fallback на день). */

import { isBenzaDateOnlyIso, normalizePlate } from '@/lib/benzaFuelReport';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

const WINDOW_MS = 45 * 60 * 1000;
const TOLERANCE_L = 5;
const TOLERANCE_PCT = 0.05;
const IN_CHUNK = 80;
const ROWS_LIMIT = 20_000;

export type FuelReconStatus =
  | 'ok'
  | 'mismatch'
  | 'scout_missing'
  | 'lukoil_or_other';

export type FuelReconRow = {
  id: string;
  atIso: string;
  mixerId: number | null;
  plate: string;
  benzaLiters: number | null;
  scoutLiters: number | null;
  deltaLiters: number | null;
  status: FuelReconStatus;
  statusLabel: string;
  /** matched by ±45min or same calendar day (MSK) */
  matchMode?: 'window' | 'day' | null;
};

export type FuelReconResult = {
  from: string;
  to: string;
  rows: FuelReconRow[];
  summary: {
    ok: number;
    mismatch: number;
    scoutMissing: number;
    lukoilOrOther: number;
    pendingUnlinked: number;
    pendingInPeriod: number;
    truncated: boolean;
  };
  /** Все несвязанные pending (не только за период) — чтобы не терять после импорта года */
  pending: Array<{
    id: number;
    plateRaw: string;
    plateNorm: string;
    filledAt: string;
    liters: number;
  }>;
};

function withinTolerance(benza: number, scout: number): boolean {
  const d = Math.abs(benza - scout);
  if (d <= TOLERANCE_L) return true;
  const base = Math.max(benza, scout, 1);
  return d / base <= TOLERANCE_PCT;
}

function ymdValid(v: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(v);
}

/** Календарный день МСК YYYY-MM-DD */
function mskDay(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso.slice(0, 10);
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(d);
}

async function fetchEntriesInChunks(
  mixerIds: number[],
  source: 'benza' | 'scout',
  fromIso: string,
  toIso: string,
): Promise<{ rows: Entry[]; truncated: boolean }> {
  type Entry = {
    id: number;
    mixer_id: number;
    filled_at: string;
    liters: number;
    source: string | null;
    fuel_type: string | null;
  };

  if (!mixerIds.length) return { rows: [], truncated: false };

  const out: Entry[] = [];
  let truncated = false;

  for (let i = 0; i < mixerIds.length; i += IN_CHUNK) {
    const chunk = mixerIds.slice(i, i + IN_CHUNK);
    let q = supabaseAdmin
      .from('fuel_entries')
      .select('id, mixer_id, filled_at, liters, source, fuel_type')
      .in('mixer_id', chunk)
      .eq('source', source)
      .gte('filled_at', fromIso)
      .lte('filled_at', toIso)
      .limit(ROWS_LIMIT);

    if (source === 'scout') {
      q = q.neq('fuel_type', 'drain');
    }

    const { data, error } = await q;
    if (error) {
      if (/fuel_entries|does not exist|relation|benza/i.test(error.message)) {
        return { rows: [], truncated: false };
      }
      throw new Error(error.message);
    }
    if (data?.length) {
      out.push(...(data as Entry[]));
      if (data.length >= ROWS_LIMIT) truncated = true;
    }
  }

  return { rows: out, truncated };
}

type Entry = {
  id: number;
  mixer_id: number;
  filled_at: string;
  liters: number;
  source: string | null;
  fuel_type: string | null;
};

function findScoutMatch(
  b: Entry,
  scout: Entry[],
  scoutUsed: Set<number>,
): { best: Entry; mode: 'window' | 'day' } | null {
  const bt = new Date(b.filled_at).getTime();
  const bDay = mskDay(b.filled_at);
  const dateOnly = isBenzaDateOnlyIso(b.filled_at);

  let bestWindow: Entry | null = null;
  let bestWindowDt = Infinity;
  let bestDay: Entry | null = null;
  let bestDayDt = Infinity;

  for (const s of scout) {
    if (s.mixer_id !== b.mixer_id) continue;
    if (scoutUsed.has(s.id)) continue;
    const st = new Date(s.filled_at).getTime();
    const dt = Math.abs(st - bt);
    if (!dateOnly && dt <= WINDOW_MS && dt < bestWindowDt) {
      bestWindow = s;
      bestWindowDt = dt;
    }
    if (mskDay(s.filled_at) === bDay && dt < bestDayDt) {
      bestDay = s;
      bestDayDt = dt;
    }
  }

  // Суточный отчёт — сразу по дню; детальный — ±45 мин, иначе день.
  if (dateOnly) {
    if (bestDay) return { best: bestDay, mode: 'day' };
    return null;
  }
  if (bestWindow) return { best: bestWindow, mode: 'window' };
  if (bestDay) return { best: bestDay, mode: 'day' };
  return null;
}

export async function buildFuelRecon(opts: {
  from: string;
  to: string;
  vehicleKind?: string | null;
}): Promise<FuelReconResult> {
  let from = ymdValid(opts.from) ? opts.from : opts.from.slice(0, 10);
  let to = ymdValid(opts.to) ? opts.to : opts.to.slice(0, 10);
  if (from > to) {
    const t = from;
    from = to;
    to = t;
  }

  const fromIso = `${from}T00:00:00+03:00`;
  const toIso = `${to}T23:59:59.999+03:00`;

  let mixersQuery = supabaseAdmin.from('mixers').select('id, number, vehicle_kind');
  if (opts.vehicleKind && opts.vehicleKind !== 'all') {
    mixersQuery = mixersQuery.eq('vehicle_kind', opts.vehicleKind);
  }
  const { data: mixers } = await mixersQuery;
  const mixerList = mixers ?? [];
  const idToNumber = new Map(mixerList.map((m) => [m.id as number, String(m.number)]));
  const mixerIds = mixerList.map((m) => m.id as number);

  const [bPack, sPack] = await Promise.all([
    fetchEntriesInChunks(mixerIds, 'benza', fromIso, toIso),
    fetchEntriesInChunks(mixerIds, 'scout', fromIso, toIso),
  ]);

  const benza = bPack.rows;
  const scout = sPack.rows;
  const truncated = bPack.truncated || sPack.truncated;

  const scoutUsed = new Set<number>();
  const rows: FuelReconRow[] = [];

  for (const b of benza) {
    const match = findScoutMatch(b, scout, scoutUsed);
    const plate = idToNumber.get(b.mixer_id) || String(b.mixer_id);

    if (match) {
      scoutUsed.add(match.best.id);
      const delta = Math.round((b.liters - match.best.liters) * 10) / 10;
      const ok = withinTolerance(Number(b.liters), Number(match.best.liters));
      const dayNote = match.mode === 'day' ? ' (день)' : '';
      rows.push({
        id: `b${b.id}`,
        atIso: b.filled_at,
        mixerId: b.mixer_id,
        plate,
        benzaLiters: Number(b.liters),
        scoutLiters: Number(match.best.liters),
        deltaLiters: delta,
        status: ok ? 'ok' : 'mismatch',
        statusLabel: ok ? `Совпадает${dayNote}` : `Расхождение${dayNote}`,
        matchMode: match.mode,
      });
    } else {
      rows.push({
        id: `b${b.id}`,
        atIso: b.filled_at,
        mixerId: b.mixer_id,
        plate,
        benzaLiters: Number(b.liters),
        scoutLiters: null,
        deltaLiters: null,
        status: 'scout_missing',
        statusLabel: 'Нет СКАУТ',
        matchMode: null,
      });
    }
  }

  for (const s of scout) {
    if (scoutUsed.has(s.id)) continue;
    rows.push({
      id: `s${s.id}`,
      atIso: s.filled_at,
      mixerId: s.mixer_id,
      plate: idToNumber.get(s.mixer_id) || String(s.mixer_id),
      benzaLiters: null,
      scoutLiters: Number(s.liters),
      deltaLiters: null,
      status: 'lukoil_or_other',
      statusLabel: 'СКАУТ / Лукойл',
      matchMode: null,
    });
  }

  rows.sort((a, b) => b.atIso.localeCompare(a.atIso));

  // Все несвязанные pending — чтобы после импорта года были видны вне текущего месяца
  const { data: pendingRaw } = await supabaseAdmin
    .from('benza_fuel_pending')
    .select('id, plate_raw, plate_norm, filled_at, liters')
    .is('linked_entry_id', null)
    .order('filled_at', { ascending: false })
    .limit(2000);

  const pending = (pendingRaw ?? []).map((p) => ({
    id: p.id as number,
    plateRaw: String(p.plate_raw),
    plateNorm: String(p.plate_norm || normalizePlate(String(p.plate_raw))),
    filledAt: String(p.filled_at),
    liters: Number(p.liters),
  }));

  const pendingInPeriod = pending.filter((p) => {
    const t = p.filledAt;
    return t >= fromIso && t <= toIso;
  }).length;

  const summary = {
    ok: rows.filter((r) => r.status === 'ok').length,
    mismatch: rows.filter((r) => r.status === 'mismatch').length,
    scoutMissing: rows.filter((r) => r.status === 'scout_missing').length,
    lukoilOrOther: rows.filter((r) => r.status === 'lukoil_or_other').length,
    pendingUnlinked: pending.length,
    pendingInPeriod,
    truncated,
  };

  return { from, to, rows, summary, pending };
}
