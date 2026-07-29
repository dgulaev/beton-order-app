/** Конкуренты Брянска и матрица сравнения прайсов (Фаза 6). */

export type CompetitorFiller = 'granite' | 'dolomite' | 'mortar';

export type Competitor = {
  id: number;
  name: string;
  short_name?: string | null;
  website?: string | null;
  phone?: string | null;
  contact?: string | null;
  address?: string | null;
  lat?: number | null;
  lon?: number | null;
  active?: boolean;
  notes?: string | null;
  parser_key?: string | null;
  sort_order?: number;
};

export type CompetitorPriceSnapshot = {
  id: number;
  competitor_id: number;
  grade_key: string;
  filler: CompetitorFiller;
  price: number | null;
  currency?: string;
  parsed_at: string;
  source_url?: string | null;
  source_kind?: string;
  notes?: string | null;
};

/**
 * Колонки матрицы.
 * Шапка = наши коды из продукции:
 *   гранит → М200
 *   известняк/доломит → М200и
 *   раствор → ТР М100
 * У конкурентов известняк = доломит = гравий (в парсерах → dolomite).
 */
export const COMPETITOR_MATRIX_GRADES: {
  grade_key: string;
  filler: CompetitorFiller;
  /** Текст в шапке таблицы */
  label: string;
  /** Код в нашем каталоге recipes.code */
  ourCode: string;
}[] = [
  { grade_key: 'М100', filler: 'granite', label: 'М100', ourCode: 'М100' },
  { grade_key: 'М150', filler: 'granite', label: 'М150', ourCode: 'М150' },
  { grade_key: 'М200', filler: 'granite', label: 'М200', ourCode: 'М200' },
  { grade_key: 'М250', filler: 'granite', label: 'М250', ourCode: 'М250' },
  { grade_key: 'М300', filler: 'granite', label: 'М300', ourCode: 'М300' },
  { grade_key: 'М350', filler: 'granite', label: 'М350', ourCode: 'М350' },
  { grade_key: 'М400', filler: 'granite', label: 'М400', ourCode: 'М400' },
  { grade_key: 'М100', filler: 'dolomite', label: 'М100и', ourCode: 'М100и' },
  { grade_key: 'М150', filler: 'dolomite', label: 'М150и', ourCode: 'М150и' },
  { grade_key: 'М200', filler: 'dolomite', label: 'М200и', ourCode: 'М200и' },
  { grade_key: 'М250', filler: 'dolomite', label: 'М250и', ourCode: 'М250и' },
  { grade_key: 'М300', filler: 'dolomite', label: 'М300и', ourCode: 'М300и' },
  { grade_key: 'М100', filler: 'mortar', label: 'ТР М100', ourCode: 'ТР М100' },
  { grade_key: 'М150', filler: 'mortar', label: 'ТР М150', ourCode: 'ТР М150' },
  { grade_key: 'М200', filler: 'mortar', label: 'ТР М200', ourCode: 'ТР М200' },
];

export const FILLER_LABELS: Record<CompetitorFiller, string> = {
  granite: 'Гранит',
  dolomite: 'Известняк / доломит',
  mortar: 'Раствор',
};

export type MatrixColumn = {
  id?: number;
  grade_key: string;
  filler: CompetitorFiller;
  label: string;
  ourCode: string;
  sort_order?: number;
};

/** Нормализовать марку: «200», «М200», «м-200» → М200 */
export function normalizeGradeKeyInput(raw: string): string | null {
  const s = String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/И$/i, '');
  const m = s.match(/М?-?(\d{2,3})/);
  if (!m) return null;
  return `М${m[1]}`;
}

/** Подпись и ourCode по типу заполнителя (наши коды). */
export function matrixColumnFromParts(
  grade_key: string,
  filler: CompetitorFiller
): Pick<MatrixColumn, 'grade_key' | 'filler' | 'label' | 'ourCode'> {
  const gk = normalizeGradeKeyInput(grade_key) || grade_key;
  if (filler === 'dolomite') {
    return { grade_key: gk, filler, label: `${gk}и`, ourCode: `${gk}и` };
  }
  if (filler === 'mortar') {
    return { grade_key: gk, filler, label: `ТР ${gk}`, ourCode: `ТР ${gk}` };
  }
  return { grade_key: gk, filler, label: gk, ourCode: gk };
}

/** Нормализация кода рецепта для сравнения. */
export function normalizeRecipeCode(code: string | null | undefined): string {
  return String(code || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/И$/i, 'И');
}

/**
 * Разбор нашего recipes.code → ячейка матрицы.
 * М300 → granite/М300; М300и → dolomite/М300; ТР М100 → mortar/М100.
 */
export function recipeToMatrixCell(r: {
  code?: string | null;
  type?: string | null;
  name?: string | null;
  price?: number | null;
}): { grade_key: string; filler: CompetitorFiller; price: number } | null {
  const price = Number(r.price);
  if (!Number.isFinite(price) || price <= 0) return null;

  const codeRaw = String(r.code || '').trim();
  if (!codeRaw) return null;
  const type = String(r.type || '').toLowerCase();
  const norm = normalizeRecipeCode(codeRaw);
  const name = String(r.name || '').toLowerCase();

  // Раствор: ТР М100 / type=mortar
  if (type === 'mortar' || norm.startsWith('ТР') || norm.startsWith('TP') || name.includes('раствор')) {
    const m = norm.match(/М(\d{2,3})/);
    if (!m) return null;
    return { grade_key: `М${m[1]}`, filler: 'mortar', price };
  }

  // Тощий / ЦПС в матрицу конкурентов не кладём
  if (type === 'lean' || type === 'cps' || norm.startsWith('ТБ') || norm.startsWith('ЦП')) {
    return null;
  }

  // Доломит / известняк: М100и, type=dolomite
  const isDolomite =
    type === 'dolomite' ||
    /И$/.test(norm) ||
    /и$/i.test(codeRaw.replace(/\s+/g, '')) ||
    name.includes('доломит') ||
    name.includes('известняк');

  const m = norm.match(/М(\d{2,3})/);
  if (!m) return null;
  const grade_key = `М${m[1]}`;

  if (isDolomite) {
    return { grade_key, filler: 'dolomite', price };
  }

  // Гранит / обычный бетон
  if (type === 'granite' || type === '' || type === 'concrete' || /^М\d{2,3}$/.test(norm)) {
    return { grade_key, filler: 'granite', price };
  }

  return { grade_key, filler: 'granite', price };
}

/** Дельта к цене ТрейдКом: отрицательная = конкурент дешевле. */
export function priceDelta(
  ourPrice: number | null | undefined,
  theirPrice: number | null | undefined
): number | null {
  if (ourPrice == null || theirPrice == null) return null;
  if (!Number.isFinite(ourPrice) || !Number.isFinite(theirPrice)) return null;
  return Math.round(theirPrice - ourPrice);
}

export function deltaColor(delta: number | null): string {
  if (delta == null) return '#64748B';
  if (delta > 0) return '#10B981'; // конкурент дороже — мы выгоднее
  if (delta < 0) return '#F87171'; // конкурент дешевле
  return '#94A3B8';
}
