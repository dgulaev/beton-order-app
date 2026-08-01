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
