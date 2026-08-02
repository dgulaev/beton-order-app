/**
 * Равномерный недосып цемента: факт в силосе vs сумма списаний по рецептам.
 * Оценка «фактической марки» — по ближайшему кг/м³ в той же семье рецептов.
 */

export type RecipeCementRow = {
  code: string;
  cement: number;
};

export type UnderdoseOrderInput = {
  orderId: number;
  client: string;
  grade: string;
  volumeM3: number;
  recipeCementKg: number;
  trips: number;
};

export type UnderdoseOrderRow = UnderdoseOrderInput & {
  actualCementKg: number;
  shortfallKg: number;
  recipeKgPerM3: number | null;
  actualKgPerM3: number | null;
  estimatedGrade: string | null;
  underdosePct: number;
};

export type UnderdoseSummary = {
  actualKg: number;
  recipeKg: number;
  shortfallKg: number;
  underdosePct: number;
  factor: number;
  volumeM3: number;
  orderCount: number;
  tripCount: number;
  avgShortfallKgPerM3: number | null;
  hasUnderdose: boolean;
};

export type UnderdoseResult = {
  summary: UnderdoseSummary;
  rows: UnderdoseOrderRow[];
};

export type RecipeFamily = 'concrete' | 'mortar' | 'lean' | 'cps' | 'other';

export function recipeFamily(grade: string | null | undefined): RecipeFamily {
  const g = String(grade || '').trim();
  if (/^ТР\b/i.test(g) || /^TR\b/i.test(g)) return 'mortar';
  if (/^ТБ\b/i.test(g) || /^TB\b/i.test(g)) return 'lean';
  if (/^Ц\/П/i.test(g) || /^Ц\/П\s*смесь/i.test(g)) return 'cps';
  if (/^М\d/i.test(g)) return 'concrete';
  return 'other';
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Ближайшая марка той же семьи по кг цемента на м³. */
export function estimateGradeFromCementKgPerM3(
  actualKgPerM3: number,
  declaredGrade: string,
  recipes: RecipeCementRow[],
): string {
  if (!Number.isFinite(actualKgPerM3) || actualKgPerM3 < 0) return '—';

  const fam = recipeFamily(declaredGrade);
  const candidates = recipes
    .filter((r) => Number(r.cement) > 0 && recipeFamily(r.code) === fam)
    .map((r) => ({ code: r.code, cement: Number(r.cement) }));

  if (candidates.length === 0) {
    return `~${Math.round(actualKgPerM3)} кг/м³`;
  }

  const minKg = Math.min(...candidates.map((c) => c.cement));
  let best = candidates[0];
  let bestDiff = Math.abs(best.cement - actualKgPerM3);
  for (const c of candidates) {
    const d = Math.abs(c.cement - actualKgPerM3);
    if (d < bestDiff) {
      best = c;
      bestDiff = d;
    }
  }

  if (actualKgPerM3 < minKg - 5) {
    if (fam === 'concrete') return `ниже М100 (~${Math.round(actualKgPerM3)} кг/м³)`;
    if (fam === 'mortar') return `ниже ТР М75 (~${Math.round(actualKgPerM3)} кг/м³)`;
    if (fam === 'lean') return `ниже ТБ М100 (~${Math.round(actualKgPerM3)} кг/м³)`;
    if (fam === 'cps') return `ниже Ц/П М100 (~${Math.round(actualKgPerM3)} кг/м³)`;
    return `ниже нормы (~${Math.round(actualKgPerM3)} кг/м³)`;
  }

  return `≈ ${best.code}`;
}

export function computeCementUnderdose(
  orders: UnderdoseOrderInput[],
  actualKg: number,
  recipes: RecipeCementRow[],
): UnderdoseResult {
  const recipeKg = orders.reduce((s, o) => s + Number(o.recipeCementKg || 0), 0);
  const volumeM3 = orders.reduce((s, o) => s + Number(o.volumeM3 || 0), 0);
  const tripCount = orders.reduce((s, o) => s + Number(o.trips || 0), 0);
  const safeActual = Math.max(0, Number(actualKg) || 0);

  const factor = recipeKg > 0 ? safeActual / recipeKg : 1;
  const shortfallKg = Math.max(0, recipeKg - safeActual);
  const hasUnderdose = recipeKg > 0 && safeActual < recipeKg - 0.05;
  const underdosePct = hasUnderdose ? (1 - factor) * 100 : 0;

  const rows: UnderdoseOrderRow[] = orders.map((o) => {
    const oRecipe = Number(o.recipeCementKg || 0);
    const oVol = Number(o.volumeM3 || 0);
    const oActual = hasUnderdose ? oRecipe * factor : oRecipe;
    const oShort = hasUnderdose ? oRecipe - oActual : 0;
    const recipeKgPerM3 = oVol > 0 ? oRecipe / oVol : null;
    const actualKgPerM3 = oVol > 0 ? oActual / oVol : null;
    const estimatedGrade =
      hasUnderdose && actualKgPerM3 != null
        ? estimateGradeFromCementKgPerM3(actualKgPerM3, o.grade, recipes)
        : o.grade
          ? `≈ ${o.grade}`
          : null;

    return {
      ...o,
      recipeCementKg: round1(oRecipe),
      volumeM3: round2(oVol),
      actualCementKg: round1(oActual),
      shortfallKg: round1(oShort),
      recipeKgPerM3: recipeKgPerM3 != null ? round1(recipeKgPerM3) : null,
      actualKgPerM3: actualKgPerM3 != null ? round1(actualKgPerM3) : null,
      estimatedGrade,
      underdosePct: round1(underdosePct),
    };
  });

  rows.sort((a, b) => a.orderId - b.orderId);

  return {
    summary: {
      actualKg: round1(safeActual),
      recipeKg: round1(recipeKg),
      shortfallKg: round1(shortfallKg),
      underdosePct: round1(underdosePct),
      factor: round2(factor),
      volumeM3: round2(volumeM3),
      orderCount: orders.length,
      tripCount,
      avgShortfallKgPerM3:
        hasUnderdose && volumeM3 > 0 ? round1(shortfallKg / volumeM3) : null,
      hasUnderdose,
    },
    rows,
  };
}

export function clientLabel(order: {
  organization_name?: string | null;
  full_name?: string | null;
  client_name?: string | null;
}): string {
  const org = String(order.organization_name || '').trim();
  const full = String(order.full_name || '').trim();
  const cn = String(order.client_name || '').trim();
  return org || full || cn || '—';
}

/* ─── История силоса / фильтры ops / таймлайн / риск-заявки ─── */

export const CANCEL_PAIR_WINDOW_MS = 15 * 60 * 1000;
export const AMOUNT_MATCH_KG = 0.2;
export const CLUSTER_WINDOW_MS = 2 * 60 * 1000;

export type WarehouseOpRaw = {
  id: number;
  operationType: string;
  amountKg: number;
  oldKg: number | null;
  newKg: number | null;
  userName: string | null;
  createdAt: string;
  orderId?: number | null;
};

export type ClassifiedOp = WarehouseOpRaw & {
  isAutoWriteoff: boolean;
  isManualSubtract: boolean;
  isAdd: boolean;
  isReset: boolean;
  isCancelledMistake: boolean;
  isRealRefill: boolean;
  ignoredInCalc: boolean;
};

export type RefillContext = {
  refillId: number | null;
  createdAt: string | null;
  userName: string | null;
  beforeKg: number | null;
  amountKg: number;
  afterKg: number | null;
  /** Минус до внесения/обнуления (кг, положительное число = глубина минуса) */
  deficitBeforeKg: number | null;
  deficitSource: 'refill_old' | 'reset' | 'savings' | null;
  expectedSavingKg: number;
  savingAssessment: 'normal' | 'anomaly' | 'none';
};

export type TimelineEvent = {
  id: number;
  createdAt: string;
  operationType: string;
  label: string;
  amountKg: number;
  oldKg: number | null;
  newKg: number | null;
  userName: string | null;
  /** Имя оператора/смены для колонки «Кто» */
  operatorName: string | null;
  orderId: number | null;
  ignoredInCalc: boolean;
  cancelPair: boolean;
  isNegativeCrossing: boolean;
  isSelectedRefill: boolean;
  inDeficit: boolean;
};

export type RiskOrderRow = UnderdoseOrderInput & {
  recipeCementKg: number;
};

export type RiskOrdersSummary = {
  recipeKg: number;
  volumeM3: number;
  orderCount: number;
  tripCount: number;
  firstNegativeAt: string | null;
  firstNegativeOrderId: number | null;
};

export type SiloHistoryBundle = {
  refillContext: RefillContext | null;
  timeline: TimelineEvent[];
  riskOrders: RiskOrderRow[];
  riskSummary: RiskOrdersSummary;
};

function parseOrderIdFromUserName(userName: string | null | undefined): number | null {
  const m = String(userName || '').match(/заявка\s*#\s*(\d+)/i);
  if (!m) return null;
  const id = Number(m[1]);
  return Number.isFinite(id) && id > 0 ? id : null;
}

/** Имя оператора из user_name журнала («смена Максим», «Семён», MEKA…). */
export function extractOperatorName(userName: string | null | undefined): string | null {
  const raw = String(userName || '').trim();
  if (!raw) return null;
  const shift = raw.match(/смена\s+([^·]+)/i);
  if (shift) return shift[1].trim() || null;
  if (/^Автосписание\b/i.test(raw) || /^Возврат\b/i.test(raw) || /^Корректировка\b/i.test(raw)) {
    const parts = raw.split(/\s*·\s*/).map((p) => p.trim()).filter(Boolean);
    const last = parts[parts.length - 1] || '';
    const cleaned = last.replace(/^смена\s+/i, '').replace(/\s*\(задним числом\)\s*$/i, '').trim();
    return cleaned || null;
  }
  if (/Компенсация\s*MEKA/i.test(raw)) return 'MEKA';
  // Чистое имя: «Семён», «Максим»
  if (!/заявка\s*#/i.test(raw) && raw.length <= 40) return raw;
  return raw.split(/\s*·\s*/)[0]?.trim() || raw;
}

/** Техническое/крошечное «внесение» — не загрузка цемента (MEKA-копейки и т.п.). */
export function isNonRefillAdd(op: {
  operationType: string;
  amountKg: number;
  userName?: string | null;
}): boolean {
  if (String(op.operationType) !== 'add') return false;
  const name = String(op.userName || '');
  if (/Компенсация\s*MEKA/i.test(name)) return true;
  if (/^Корректировка\b/i.test(name)) return true;
  // Меньше 50 кг — не считаем загрузкой для недосыпа
  if (Number(op.amountKg) > 0 && Number(op.amountKg) < 50) return true;
  return false;
}

export function isAutoWriteoffOp(op: {
  operationType: string;
  userName?: string | null;
  orderId?: number | null;
}): boolean {
  if (String(op.operationType) !== 'subtract') return false;
  const name = String(op.userName || '');
  if (/^Автосписание\b/i.test(name)) return true;
  if (op.orderId != null && Number(op.orderId) > 0) return true;
  if (parseOrderIdFromUserName(name) != null) return true;
  return false;
}

export function classifyWarehouseOps(ops: WarehouseOpRaw[]): ClassifiedOp[] {
  const sorted = [...ops].sort(
    (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id - b.id,
  );

  const cancelledIds = new Set<number>();
  const adds = sorted.filter(
    (o) => o.operationType === 'add' && Number(o.amountKg) > 0,
  );
  const manuals = sorted.filter(
    (o) => o.operationType === 'subtract' && !isAutoWriteoffOp(o),
  );

  for (const add of adds) {
    if (cancelledIds.has(add.id)) continue;
    const addMs = Date.parse(add.createdAt);
    const amount = Number(add.amountKg);
    let best: WarehouseOpRaw | null = null;
    let bestDist = Infinity;
    for (const sub of manuals) {
      if (cancelledIds.has(sub.id)) continue;
      const subMs = Date.parse(sub.createdAt);
      if (subMs < addMs) continue;
      if (subMs - addMs > CANCEL_PAIR_WINDOW_MS) continue;
      if (Math.abs(Number(sub.amountKg) - amount) > AMOUNT_MATCH_KG) continue;
      const dist = subMs - addMs;
      if (dist < bestDist) {
        bestDist = dist;
        best = sub;
      }
    }
    if (best) {
      cancelledIds.add(add.id);
      cancelledIds.add(best.id);
    }
  }

  return sorted.map((op) => {
    const isAdd = op.operationType === 'add' && Number(op.amountKg) > 0;
    const isReset = op.operationType === 'reset';
    const isAuto = isAutoWriteoffOp(op);
    const isManualSubtract = op.operationType === 'subtract' && !isAuto;
    const isCancelledMistake = cancelledIds.has(op.id);
    const technical = isNonRefillAdd(op);
    const isRealRefill = isAdd && !isCancelledMistake && !technical;
    const ignoredInCalc =
      isCancelledMistake
      || isManualSubtract
      || technical
      || (isAdd && !isRealRefill);
    return {
      ...op,
      orderId: op.orderId ?? parseOrderIdFromUserName(op.userName),
      isAutoWriteoff: isAuto,
      isManualSubtract,
      isAdd,
      isReset,
      isCancelledMistake,
      isRealRefill,
      ignoredInCalc,
    };
  });
}

/** Список реальных загрузок (не погашенных парой ±X), новые сверху. */
export function filterRealRefills(
  classified: ClassifiedOp[],
): ClassifiedOp[] {
  return classified
    .filter((o) => o.isRealRefill)
    .sort(
      (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id - a.id,
    );
}

export function assessSavingVsNorm(
  deficitKg: number | null | undefined,
  expectedSavingKg: number,
): 'normal' | 'anomaly' | 'none' {
  const d = Number(deficitKg);
  if (!Number.isFinite(d) || d <= 0) return 'none';
  // Норма: до 1.5× ожидаемой экономии; выше — аномалия
  const soft = Math.max(expectedSavingKg * 1.5, expectedSavingKg + 500);
  return d <= soft ? 'normal' : 'anomaly';
}

export function buildRefillContext(opts: {
  selected: ClassifiedOp | null;
  classified: ClassifiedOp[];
  expectedSavingKg: number;
  savingsNear?: Array<{ balanceBeforeTons: number; createdAt: string; amountKg: number }>;
}): RefillContext | null {
  const { selected, classified, expectedSavingKg, savingsNear } = opts;
  if (!selected) return null;

  const beforeKg = selected.oldKg;
  const afterKg = selected.newKg;
  const amountKg = Number(selected.amountKg) || 0;
  const selMs = Date.parse(selected.createdAt);

  let deficitBeforeKg: number | null = null;
  let deficitSource: RefillContext['deficitSource'] = null;

  if (beforeKg != null && beforeKg < -0.05) {
    deficitBeforeKg = round1(Math.abs(beforeKg));
    deficitSource = 'refill_old';
  }

  // Кластер: reset с минусом незадолго до внесения
  if (deficitBeforeKg == null) {
    for (const op of classified) {
      if (!op.isReset) continue;
      const ms = Date.parse(op.createdAt);
      if (ms > selMs || selMs - ms > CLUSTER_WINDOW_MS) continue;
      const old = op.oldKg;
      if (old != null && old < -0.05) {
        deficitBeforeKg = round1(Math.abs(old));
        deficitSource = 'reset';
        break;
      }
    }
  }

  if (deficitBeforeKg == null && savingsNear?.length) {
    let best: { balanceBeforeTons: number; createdAt: string } | null = null;
    let bestDist = Infinity;
    for (const s of savingsNear) {
      const ms = Date.parse(s.createdAt);
      if (!Number.isFinite(ms)) continue;
      if (ms > selMs + 30_000) continue;
      if (selMs - ms > CLUSTER_WINDOW_MS * 2) continue;
      if (!(s.balanceBeforeTons < 0)) continue;
      const dist = Math.abs(selMs - ms);
      if (dist < bestDist) {
        bestDist = dist;
        best = s;
      }
    }
    if (best) {
      deficitBeforeKg = round1(Math.abs(best.balanceBeforeTons) * 1000);
      deficitSource = 'savings';
    }
  }

  return {
    refillId: selected.id,
    createdAt: selected.createdAt,
    userName: selected.userName,
    beforeKg: beforeKg != null ? round1(beforeKg) : null,
    amountKg: round1(amountKg),
    afterKg: afterKg != null ? round1(afterKg) : null,
    deficitBeforeKg,
    deficitSource,
    expectedSavingKg: round1(expectedSavingKg),
    savingAssessment: assessSavingVsNorm(deficitBeforeKg, expectedSavingKg),
  };
}

function opLabel(op: ClassifiedOp): string {
  if (op.isCancelledMistake && op.isAdd) return 'Внесение (отмена ошибки)';
  if (op.isCancelledMistake && op.isManualSubtract) return 'Списание (отмена ошибки)';
  if (op.isReset) return 'Обнуление';
  if (op.isRealRefill) return 'Внесение';
  if (op.isAdd) return 'Внесение';
  if (op.isAutoWriteoff) return 'Автосписание';
  if (op.isManualSubtract) return 'Ручное списание';
  return op.operationType || 'Операция';
}

export function buildSiloTimeline(opts: {
  classified: ClassifiedOp[];
  selectedRefillId: number | null;
  fromMs: number;
  toMs: number;
}): TimelineEvent[] {
  const { classified, selectedRefillId, fromMs, toMs } = opts;
  let seenNegativeCrossing = false;
  const events: TimelineEvent[] = [];

  for (const op of classified) {
    const ms = Date.parse(op.createdAt);
    if (!Number.isFinite(ms) || ms < fromMs || ms > toMs) continue;

    const oldKg = op.oldKg;
    const newKg = op.newKg;
    const isCrossing =
      !seenNegativeCrossing
      && oldKg != null
      && newKg != null
      && oldKg >= -0.05
      && newKg < -0.05
      && op.isAutoWriteoff;
    if (isCrossing) seenNegativeCrossing = true;

    const inDeficit =
      (newKg != null && newKg < -0.05)
      || (oldKg != null && oldKg < -0.05 && op.isAutoWriteoff);

    events.push({
      id: op.id,
      createdAt: op.createdAt,
      operationType: op.operationType,
      label: opLabel(op),
      amountKg: round1(Number(op.amountKg) || 0),
      oldKg: oldKg != null ? round1(oldKg) : null,
      newKg: newKg != null ? round1(newKg) : null,
      userName: op.userName,
      operatorName: extractOperatorName(op.userName),
      orderId: op.orderId ?? null,
      ignoredInCalc: op.ignoredInCalc || op.isManualSubtract,
      cancelPair: op.isCancelledMistake,
      isNegativeCrossing: isCrossing,
      isSelectedRefill: selectedRefillId != null && op.id === selectedRefillId,
      inDeficit: Boolean(inDeficit),
    });
  }

  return events;
}

export function findFirstNegativeCrossing(
  classified: ClassifiedOp[],
  beforeMs: number,
  afterMs: number = 0,
): ClassifiedOp | null {
  for (const op of classified) {
    const ms = Date.parse(op.createdAt);
    if (!Number.isFinite(ms) || ms >= beforeMs || ms < afterMs) continue;
    if (!op.isAutoWriteoff) continue;
    const oldKg = op.oldKg;
    const newKg = op.newKg;
    if (oldKg != null && newKg != null && oldKg >= -0.05 && newKg < -0.05) {
      return op;
    }
  }
  // Если явного crossing нет — первое автосписание, после которого new < 0
  for (const op of classified) {
    const ms = Date.parse(op.createdAt);
    if (!Number.isFinite(ms) || ms >= beforeMs || ms < afterMs) continue;
    if (!op.isAutoWriteoff) continue;
    if (op.newKg != null && op.newKg < -0.05) return op;
  }
  return null;
}

export function buildRiskOrders(opts: {
  classified: ClassifiedOp[];
  selectedRefillAt: string;
  /** Нижняя граница поиска аномалии (lookback); по умолчанию — 14 суток до загрузки */
  afterMs?: number;
  /** Верхняя граница риска: «до конца» периода (until). По умолчанию — момент выбранной загрузки. */
  untilMs?: number;
  orderMeta: Map<number, { client: string; grade: string }>;
  /** volume/cement по order_id из автосписаний в рисковом окне (если нет — из amount ops) */
  tripAgg?: Map<number, { volumeM3: number; recipeCementKg: number; trips: number }>;
}): { rows: RiskOrderRow[]; summary: RiskOrdersSummary } {
  const selMs = Date.parse(opts.selectedRefillAt);
  const lookbackMs =
    opts.afterMs ?? (Number.isFinite(selMs) ? selMs - 14 * 86400000 : 0);
  const untilMs =
    opts.untilMs != null && Number.isFinite(opts.untilMs)
      ? opts.untilMs
      : selMs;
  const first = findFirstNegativeCrossing(opts.classified, selMs, lookbackMs);

  const emptySummary: RiskOrdersSummary = {
    recipeKg: 0,
    volumeM3: 0,
    orderCount: 0,
    tripCount: 0,
    firstNegativeAt: null,
    firstNegativeOrderId: null,
  };

  // Риск: от первого ухода в минус (если был) или от выбранной загрузки — до конца периода
  const fromMs = first ? Date.parse(first.createdAt) : selMs;
  const toMs = Math.max(untilMs, selMs);

  const byOrder = new Map<
    number,
    { volumeM3: number; recipeCementKg: number; trips: number }
  >();

  for (const op of opts.classified) {
    if (!op.isAutoWriteoff) continue;
    const ms = Date.parse(op.createdAt);
    if (!Number.isFinite(ms) || ms < fromMs || ms > toMs) continue;
    const oid = op.orderId ?? parseOrderIdFromUserName(op.userName);
    if (!oid) continue;
    if (!byOrder.has(oid)) {
      byOrder.set(oid, { volumeM3: 0, recipeCementKg: 0, trips: 0 });
    }
    const a = byOrder.get(oid)!;
    a.recipeCementKg += Number(op.amountKg) || 0;
    a.trips += 1;
  }

  if (byOrder.size === 0 && !first) {
    return { rows: [], summary: emptySummary };
  }

  // Подменить агрегаты tripAgg для объёма/точного цемента, если переданы за окно
  if (opts.tripAgg) {
    for (const [oid, agg] of byOrder) {
      const t = opts.tripAgg.get(oid);
      if (t) {
        agg.volumeM3 = t.volumeM3;
        agg.recipeCementKg = t.recipeCementKg;
        agg.trips = t.trips;
      }
    }
  }

  const rows: RiskOrderRow[] = [...byOrder.entries()].map(([orderId, agg]) => {
    const meta = opts.orderMeta.get(orderId);
    return {
      orderId,
      client: meta?.client || '—',
      grade: meta?.grade || '—',
      volumeM3: round2(agg.volumeM3),
      recipeCementKg: round1(agg.recipeCementKg),
      trips: agg.trips,
    };
  });
  rows.sort((a, b) => a.orderId - b.orderId);

  const recipeKg = rows.reduce((s, r) => s + r.recipeCementKg, 0);
  const volumeM3 = rows.reduce((s, r) => s + r.volumeM3, 0);
  const tripCount = rows.reduce((s, r) => s + r.trips, 0);

  return {
    rows,
    summary: {
      recipeKg: round1(recipeKg),
      volumeM3: round2(volumeM3),
      orderCount: rows.length,
      tripCount,
      firstNegativeAt: first?.createdAt ?? null,
      firstNegativeOrderId: first
        ? first.orderId ?? parseOrderIdFromUserName(first.userName)
        : null,
    },
  };
}

export function pickSelectedRefill(
  realRefills: ClassifiedOp[],
  sinceIso: string | null,
  preferredId?: number | null,
): ClassifiedOp | null {
  if (preferredId != null) {
    const byId = realRefills.find((r) => r.id === preferredId);
    if (byId) return byId;
  }
  if (!sinceIso) return realRefills[0] || null;
  const sinceMs = Date.parse(sinceIso);
  if (!Number.isFinite(sinceMs)) return realRefills[0] || null;
  let best: ClassifiedOp | null = null;
  let bestDist = Infinity;
  for (const r of realRefills) {
    const dist = Math.abs(Date.parse(r.createdAt) - sinceMs);
    if (dist < bestDist) {
      bestDist = dist;
      best = r;
    }
  }
  return best;
}

export function previousRealRefill(
  realRefillsNewestFirst: ClassifiedOp[],
  selected: ClassifiedOp,
): ClassifiedOp | null {
  const older = realRefillsNewestFirst
    .filter((r) => Date.parse(r.createdAt) < Date.parse(selected.createdAt))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return older[0] || null;
}
