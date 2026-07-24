// lib/recipeAdditives.ts
// Общая логика подбора рецепта по марке заявки/рейса и определения, какая
// химическая добавка и в каком количестве по ней положена — используется и
// на сервере (lib/orderMixers.ts — реальное списание со склада при разгрузке
// миксера), и на клиенте (adminCifra/warehouse — расчёт КПИ карточек «Расход
// сегодня»), и в /adminCifra/zayavki (плановый расход на день). Модуль не
// делает I/O (никаких supabase/fetch), поэтому безопасен для импорта в любом
// окружении — просто набор чистых функций над уже загруженным списком рецептов.
//
// Плотность (кг/л) задаётся в lab_settings (настройки лаборатории) и передаётся
// сюда через AdditiveDensities; константы ниже — только fallback.

import {
  isMekaServiceGrade,
  normalizeGradeKey,
  resolveMekaToRecipeCode,
} from '@/lib/mekaGradeMap';

export interface RecipeLike {
  code?: string | null;
  name?: string | null;
  type?: string | null;
  cement?: number | null;
  sand?: number | null;       // кг на 1 м³
  gravel?: number | null;     // щебень, кг на 1 м³
  additive?: number | null;   // Добавка 1 — ПФМ-НЛК, кг на 1 м³
  additive2?: number | null;  // Добавка 2 — Линомикс ТипР, кг на 1 м³
}

export interface AdditiveDosage {
  /** 1 = ПФМ-НЛК, 2 = Линомикс ТипР — совпадает с warehouse_additives.additive_id */
  additiveId: 1 | 2;
  name: string;
  kgPerM3: number;
  /** Плотность добавки (кг на 1 литр) — используется для перевода кг → литры при списании со склада */
  densityKgPerLiter: number;
}

/** Плотности из lab_settings (или любого другого источника), кг/л. */
export type AdditiveDensities = Partial<Record<1 | 2, number>>;

/** Fallback, если в lab_settings плотность ещё не задана / колонок нет. */
export const ADDITIVE_DENSITY_KG_PER_LITER: Record<1 | 2, number> = {
  1: 1.16, // ПФМ-НЛК
  2: 1.18, // Линомикс ТипР
};

export const ADDITIVE_NAMES: Record<1 | 2, string> = {
  1: 'ПФМ-НЛК',
  2: 'Линомикс ТипР',
};

export function getAdditiveDensity(
  additiveId: 1 | 2,
  densities?: AdditiveDensities | null
): number {
  const override = Number(densities?.[additiveId]);
  if (Number.isFinite(override) && override > 0) return override;
  return ADDITIVE_DENSITY_KG_PER_LITER[additiveId];
}

/** Разбор строки lab_settings → плотности для additive_id 1/2. */
export function densitiesFromLabSettings(
  row:
    | {
        pfm_density_kg_per_l?: number | string | null;
        linomix_density_kg_per_l?: number | string | null;
      }
    | null
    | undefined
): AdditiveDensities {
  const pfm = Number(row?.pfm_density_kg_per_l);
  const lin = Number(row?.linomix_density_kg_per_l);
  return {
    1: Number.isFinite(pfm) && pfm > 0 ? pfm : undefined,
    2: Number.isFinite(lin) && lin > 0 ? lin : undefined,
  };
}

/**
 * Поступление на склад: добавку привозят в тоннах, остаток ёмкостей — в литрах.
 * литры = тонны × 1000 / плотность (кг/л).
 */
export function tonsToAdditiveLiters(
  additiveId: 1 | 2,
  tons: number,
  densities?: AdditiveDensities | null
): number {
  const density = getAdditiveDensity(additiveId, densities);
  if (!tons || tons <= 0 || !density) return 0;
  return (tons * 1000) / density;
}

function recipeCodeKey(code: string | null | undefined): string {
  return normalizeGradeKey(String(code || '').trim());
}

/**
 * Поиск рецепта по марке заявки / MEKA / отгрузки.
 * Порядок: служебные MEKA → словарь MEKA→код → точный code →
 * нормализованный code → доломит «и» → самое длинное вхождение code → name.
 */
export function findRecipeByGrade<T extends RecipeLike>(recipes: T[], grade: string | null | undefined): T | null {
  if (!grade || !Array.isArray(recipes) || recipes.length === 0) return null;
  const trimmed = grade.trim();
  if (!trimmed) return null;
  if (isMekaServiceGrade(trimmed)) return null;

  const byExactCode = (code: string) =>
    recipes.find((r) => String(r.code || '').trim() === code) || null;

  const byCodeKey = (key: string) => {
    if (!key) return null;
    return recipes.find((r) => recipeCodeKey(r.code) === key) || null;
  };

  const mapped = resolveMekaToRecipeCode(trimmed);
  if (mapped) {
    const hit = byExactCode(mapped) || byCodeKey(normalizeGradeKey(mapped));
    if (hit) return hit;
  }

  let recipe = byExactCode(trimmed);
  if (recipe) return recipe;

  const gradeKey = normalizeGradeKey(trimmed);
  recipe = byCodeKey(gradeKey);
  if (recipe) return recipe;

  // доломит: М100И / «м100 и» → М100и (если словарь не сработал)
  if (/И$/.test(gradeKey)) {
    const dolomiteKey = gradeKey; // М100И
    recipe = byCodeKey(dolomiteKey);
    if (recipe) return recipe;
    // code в каталоге с маленькой «и»: ключ всё равно М100И после normalize
  }

  // Самое длинное вхождение кода в марку (ТР М150 раньше М150)
  const graded = recipes
    .map((r) => ({ r, key: recipeCodeKey(r.code) }))
    .filter(({ key }) => key.length >= 3 && gradeKey.includes(key))
    .sort((a, b) => b.key.length - a.key.length);
  if (graded[0]) return graded[0].r;

  recipe = recipes.find((r) => r.name?.toLowerCase().includes(trimmed.toLowerCase())) || null;
  return recipe;
}

/**
 * Какая добавка и в каком количестве (кг на 1 м³) положена по рецепту.
 * Раствор (additive2 > 0) и бетон (additive > 0) взаимоисключающие колонки
 * в текущих рецептах — если задано и то, и другое, приоритет отдаём типу
 * рецепта (mortar → Линомикс), иначе первой непустой колонке.
 */
export function getAdditiveDosage(
  recipe: RecipeLike | null | undefined,
  densities?: AdditiveDensities | null
): AdditiveDosage | null {
  if (!recipe) return null;

  const additive1 = Number(recipe.additive || 0);
  const additive2 = Number(recipe.additive2 || 0);

  const useSecond = recipe.type === 'mortar' ? additive2 > 0 : additive2 > 0 && additive1 <= 0;

  if (useSecond) {
    return {
      additiveId: 2,
      name: ADDITIVE_NAMES[2],
      kgPerM3: additive2,
      densityKgPerLiter: getAdditiveDensity(2, densities),
    };
  }
  if (additive1 > 0) {
    return {
      additiveId: 1,
      name: ADDITIVE_NAMES[1],
      kgPerM3: additive1,
      densityKgPerLiter: getAdditiveDensity(1, densities),
    };
  }
  return null;
}

/** Итог по объёму рейса/заявки: сколько кг добавки и сколько это литров на складе. */
export function calculateAdditiveUsage(
  recipe: RecipeLike | null | undefined,
  volumeM3: number,
  densities?: AdditiveDensities | null
) {
  const dosage = getAdditiveDosage(recipe, densities);
  if (!dosage || !volumeM3 || volumeM3 <= 0) return null;

  const kg = volumeM3 * dosage.kgPerM3;
  const liters = kg / dosage.densityKgPerLiter;

  return { ...dosage, volumeM3, kg, liters };
}

/** Расход цемента (кг) на объём рейса/заявки по реальной дозировке рецепта. */
export function calculateCementUsageKg(recipe: RecipeLike | null | undefined, volumeM3: number): number {
  if (!recipe || !volumeM3 || volumeM3 <= 0) return 0;
  return volumeM3 * Number(recipe.cement || 0);
}

/** Расход песка (кг) по дозировке рецепта. */
export function calculateSandUsageKg(recipe: RecipeLike | null | undefined, volumeM3: number): number {
  if (!recipe || !volumeM3 || volumeM3 <= 0) return 0;
  return volumeM3 * Number(recipe.sand || 0);
}

/** Расход щебня (кг) по дозировке рецепта. */
export function calculateGravelUsageKg(recipe: RecipeLike | null | undefined, volumeM3: number): number {
  if (!recipe || !volumeM3 || volumeM3 <= 0) return 0;
  return volumeM3 * Number(recipe.gravel || 0);
}
