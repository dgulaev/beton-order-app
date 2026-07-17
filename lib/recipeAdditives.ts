// lib/recipeAdditives.ts
// Общая логика подбора рецепта по марке заявки/рейса и определения, какая
// химическая добавка и в каком количестве по ней положена — используется и
// на сервере (lib/orderMixers.ts — реальное списание со склада при разгрузке
// миксера), и на клиенте (adminCifra/warehouse — расчёт КПИ карточек «Расход
// сегодня»), и в /adminCifra/zayavki (плановый расход на день). Модуль не
// делает I/O (никаких supabase/fetch), поэтому безопасен для импорта в любом
// окружении — просто набор чистых функций над уже загруженным списком рецептов.

export interface RecipeLike {
  code?: string | null;
  name?: string | null;
  type?: string | null;
  cement?: number | null;
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

export const ADDITIVE_DENSITY_KG_PER_LITER: Record<1 | 2, number> = {
  1: 1.16, // ПФМ-НЛК
  2: 1.18, // Линомикс ТипР
};

export const ADDITIVE_NAMES: Record<1 | 2, string> = {
  1: 'ПФМ-НЛК',
  2: 'Линомикс ТипР',
};

/**
 * Поиск рецепта по марке — тот же порядок проверок, что уже проверен в
 * /adminCifra/zayavki (plановый расчёт добавок на день): точное совпадение
 * кода, код без хвостового «и» (доломит), вхождение кода марки в строку,
 * вхождение марки в название рецепта.
 */
export function findRecipeByGrade<T extends RecipeLike>(recipes: T[], grade: string | null | undefined): T | null {
  if (!grade || !Array.isArray(recipes) || recipes.length === 0) return null;
  const trimmed = grade.trim();
  if (!trimmed) return null;

  let recipe = recipes.find((r) => r.code === trimmed);
  if (!recipe) recipe = recipes.find((r) => r.code === trimmed.replace(/и$/, ''));
  if (!recipe) recipe = recipes.find((r) => r.code && trimmed.includes(r.code));
  if (!recipe) recipe = recipes.find((r) => r.name?.toLowerCase().includes(trimmed.toLowerCase()));

  return recipe || null;
}

/**
 * Какая добавка и в каком количестве (кг на 1 м³) положена по рецепту.
 * Раствор (additive2 > 0) и бетон (additive > 0) взаимоисключающие колонки
 * в текущих рецептах — если задано и то, и другое, приоритет отдаём типу
 * рецепта (mortar → Линомикс), иначе первой непустой колонке.
 */
export function getAdditiveDosage(recipe: RecipeLike | null | undefined): AdditiveDosage | null {
  if (!recipe) return null;

  const additive1 = Number(recipe.additive || 0);
  const additive2 = Number(recipe.additive2 || 0);

  const useSecond = recipe.type === 'mortar' ? additive2 > 0 : additive2 > 0 && additive1 <= 0;

  if (useSecond) {
    return { additiveId: 2, name: ADDITIVE_NAMES[2], kgPerM3: additive2, densityKgPerLiter: ADDITIVE_DENSITY_KG_PER_LITER[2] };
  }
  if (additive1 > 0) {
    return { additiveId: 1, name: ADDITIVE_NAMES[1], kgPerM3: additive1, densityKgPerLiter: ADDITIVE_DENSITY_KG_PER_LITER[1] };
  }
  return null;
}

/** Итог по объёму рейса/заявки: сколько кг добавки и сколько это литров на складе. */
export function calculateAdditiveUsage(recipe: RecipeLike | null | undefined, volumeM3: number) {
  const dosage = getAdditiveDosage(recipe);
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
