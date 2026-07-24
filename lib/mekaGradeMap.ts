/**
 * Сопоставление марок из отчёта MEKA с кодами рецептов завода.
 * Подтверждено вручную 24.07.2026.
 *
 * Ключ словаря — normalizeGradeKey(имя из MEKA).
 * Значение — recipes.code как в каталоге.
 */

/** Нормализация марки/рецепта для сопоставления MEKA ↔ завод. */
export function normalizeGradeKey(value: string): string {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/Ё/g, 'Е')
    .replace(/\s+/g, '')
    .replace(/M(?=\d)/g, 'М'); // латинская M перед цифрой → кириллическая М
}

/** Служебные партии MEKA — не бетон, рецепта нет. */
export const MEKA_SERVICE_GRADE_KEYS = new Set(['ДОСЫП', 'ПРОМЫВКА', 'ССЫПКА']);

export function isMekaServiceGrade(value: string | null | undefined): boolean {
  const key = normalizeGradeKey(String(value || ''));
  return Boolean(key && MEKA_SERVICE_GRADE_KEYS.has(key));
}

/**
 * MEKA (после normalizeGradeKey) → recipes.code.
 * «полы бд» — отдельные рецепты без добавки (заливка под топинг).
 */
export const MEKA_GRADE_TO_RECIPE_CODE: Record<string, string> = {
  // гранит 1:1
  М100: 'М100',
  М150: 'М150',
  М200: 'М200',
  М250: 'М250',
  М300: 'М300',
  М350: 'М350',
  М400: 'М400',
  М450: 'М450',
  М500: 'М500',
  М600: 'М600',

  // доломит: хвост «и» в MEKA
  М100И: 'М100и',
  М150И: 'М150и',
  М200И: 'М200и',
  М250И: 'М250и',

  // спец. без отдельного рецепта → базовый
  М250ПОЛЫ: 'М250',
  М400СВАИ: 'М400',
  М450F300: 'М450',

  // полы под топинг — без добавки, остальное как у обычного
  М300ПОЛЫБД: 'М300 полы бд',
  М350ПОЛЫБД: 'М350 полы бд',

  // растворы
  ТРМ75: 'ТР М75',
  ТРМ100: 'ТР М100',
  'ТРМ100Б.Д.': 'ТР М100',
  ТРМ150: 'ТР М150',
  ТРМ200: 'ТР М200',

  // тощий бетон (в MEKA иногда с хвостом \2\)
  ТБМ100: 'ТБ М100',
  'ТБМ100\\2\\': 'ТБ М100',
  ТБМ200: 'ТБ М200',

  // ЦПС
  ЦПСМ100: 'Ц/П смесь М100',
  ЦПСМ200: 'Ц/П смесь М200',
};

/** Код рецепта завода для строки MEKA, или null (служебное / неизвестно). */
export function resolveMekaToRecipeCode(mekaRecipe: string | null | undefined): string | null {
  const key = normalizeGradeKey(String(mekaRecipe || ''));
  if (!key || MEKA_SERVICE_GRADE_KEYS.has(key)) return null;

  if (MEKA_GRADE_TO_RECIPE_CODE[key]) return MEKA_GRADE_TO_RECIPE_CODE[key];

  // тб м100 \2\ → после нормализации возможны варианты со слэшами
  if (key.startsWith('ТБМ100')) return 'ТБ М100';
  if (key.startsWith('ТБМ200')) return 'ТБ М200';
  if (key.startsWith('ТРМ100')) return 'ТР М100';

  return null;
}

/**
 * Канонический ключ для сверки MEKA ↔ отгрузка / рейс:
 * сначала словарь MEKA, иначе нормализованная исходная строка.
 */
export function canonicalGradeKey(grade: string | null | undefined): string {
  const raw = String(grade || '').trim();
  if (!raw) return '';
  const resolved = resolveMekaToRecipeCode(raw);
  return normalizeGradeKey(resolved || raw);
}
