import { CONCRETE_CONFIG, type ConcreteGrade } from '@/lib/config/concrete';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export type ListingTemplate = {
  key: string;
  title: string;
  description: string;
  price: number;
  grade?: ConcreteGrade | string;
  /** Есть сохранённое переопределение в БД */
  is_custom?: boolean;
  /** Ключ из дефолтного прайса (код/рецепты); иначе — пользовательский */
  is_builtin?: boolean;
};

const ZONE = 'Брянск и область';
const MIN_VOLUME = CONCRETE_CONFIG.limits.minVolume;

/** Запасной прайс ФБС, если рецепты из БД недоступны (актуально на 2026). */
const FBS_FALLBACK: Array<{
  code: string;
  price: number;
  length_cm: number;
  width_cm: number;
  height_cm: number;
}> = [
  { code: '12-4-6', price: 2144, length_cm: 120, width_cm: 40, height_cm: 60 },
  { code: '24-3-6', price: 3300, length_cm: 240, width_cm: 30, height_cm: 60 },
  { code: '24-4-6', price: 4200, length_cm: 240, width_cm: 40, height_cm: 60 },
  { code: '24-5-6', price: 5200, length_cm: 240, width_cm: 50, height_cm: 60 },
];

type FbsRecipeRow = {
  code: string;
  name?: string | null;
  price: number | string;
  length_cm?: number | string | null;
  width_cm?: number | string | null;
  height_cm?: number | string | null;
};

function fbsTemplateKey(code: string): string {
  return `fbs_${String(code).trim().replace(/\./g, '-')}`;
}

function formatFbsSizeCm(row: {
  length_cm?: number | string | null;
  width_cm?: number | string | null;
  height_cm?: number | string | null;
}): string | null {
  const L = Number(row.length_cm);
  const W = Number(row.width_cm);
  const H = Number(row.height_cm);
  if (![L, W, H].every((n) => Number.isFinite(n) && n > 0)) return null;
  return `${L}×${W}×${H} см`;
}

/** Шаблоны ФБС: общий + по типоразмерам (цена за 1 шт.). */
export function buildFbsListingTemplates(rows: FbsRecipeRow[] = FBS_FALLBACK): ListingTemplate[] {
  const items = rows
    .map((r) => ({
      code: String(r.code || '').trim(),
      name: (r.name || '').trim() || `ФБС ${String(r.code || '').trim()}`,
      price: Number(r.price),
      length_cm: r.length_cm,
      width_cm: r.width_cm,
      height_cm: r.height_cm,
    }))
    .filter((r) => r.code && Number.isFinite(r.price) && r.price > 0)
    .sort((a, b) => a.code.localeCompare(b.code, 'ru'));

  if (items.length === 0) return [];

  const codesLabel = items.map((i) => i.code).join(', ');
  const minPrice = Math.min(...items.map((i) => i.price));

  const service: ListingTemplate = {
    key: 'fbs_delivery',
    title: `Фундаментные блоки ФБС — ${ZONE}`,
    description: [
      `Фундаментные блоки ФБС со склада, ${ZONE}.`,
      `В наличии: ${codesLabel}.`,
      `Цена от ${minPrice.toLocaleString('ru-RU')} ₽/шт (зависит от типоразмера).`,
      'Доставка манипулятором / самовывоз — уточняйте у менеджера.',
      'Напишите типоразмер и количество — ответим по наличию и срокам.',
    ].join('\n'),
    price: minPrice,
  };

  const bySize: ListingTemplate[] = items.map((item) => {
    const size = formatFbsSizeCm(item);
    return {
      key: fbsTemplateKey(item.code),
      grade: item.code,
      title: `${item.name} — ${ZONE}`,
      description: [
        `${item.name}${size ? ` (${size})` : ''}.`,
        `Цена от ${item.price.toLocaleString('ru-RU')} ₽/шт.`,
        `Отгрузка: ${ZONE}.`,
        'Доставка манипулятором или самовывоз.',
        'Напишите количество и адрес — рассчитаем стоимость доставки.',
      ].join('\n'),
      price: item.price,
    };
  });

  return [service, ...bySize];
}

/** Дефолтные шаблоны из прайса завода (если в БД нет переопределения). */
export function buildDefaultListingTemplates(): ListingTemplate[] {
  const grades = Object.keys(CONCRETE_CONFIG.prices) as ConcreteGrade[];

  const service: ListingTemplate = {
    key: 'service_delivery',
    title: `Бетон с доставкой — ${ZONE}`,
    description: [
      `Товарный бетон с доставкой миксером по адресу в ${ZONE}.`,
      `Марки: ${grades.join(', ')}.`,
      `Минимальный объём: ${MIN_VOLUME} м³.`,
      'Возможна подача бетононасосом (уточняйте у менеджера).',
      'Цена указана за 1 м³ без доставки — итоговый расчёт после адреса и объёма.',
      'Пишите марку, объём, адрес и желаемую дату — ответим быстро.',
    ].join('\n'),
    price: CONCRETE_CONFIG.prices[CONCRETE_CONFIG.defaults.defaultGrade],
  };

  const byGrade: ListingTemplate[] = grades.map((grade) => ({
    key: `grade_${grade}`,
    grade,
    title: `Бетон ${grade} с доставкой — ${ZONE}`,
    description: [
      `Бетон ${grade}, доставка миксером (${ZONE}).`,
      `Цена от ${CONCRETE_CONFIG.prices[grade]} ₽/м³ (без доставки).`,
      `Минимальный объём: ${MIN_VOLUME} м³.`,
      'Напишите объём, адрес и дату — рассчитаем стоимость и время подачи.',
    ].join('\n'),
    price: CONCRETE_CONFIG.prices[grade],
  }));

  return [service, ...byGrade, ...buildFbsListingTemplates()];
}

/** @deprecated используйте buildDefaultListingTemplates / listListingTemplates */
export function buildListingTemplates(): ListingTemplate[] {
  return buildDefaultListingTemplates();
}

function rowToTemplate(
  row: {
    key: string;
    title: string;
    description: string;
    price: number | string;
    grade?: string | null;
  },
  opts?: { is_builtin?: boolean },
): ListingTemplate {
  return {
    key: row.key,
    title: row.title,
    description: row.description,
    price: Number(row.price),
    grade: row.grade || undefined,
    is_custom: true,
    is_builtin: opts?.is_builtin === true,
  };
}

export type ListTemplatesResult = {
  templates: ListingTemplate[];
  /** false — таблица ещё не создана в Supabase */
  persistable: boolean;
  persistError?: string;
};

async function loadFbsRecipes(): Promise<FbsRecipeRow[]> {
  const { data, error } = await supabaseAdmin
    .from('recipes')
    .select('code, name, price, length_cm, width_cm, height_cm')
    .eq('is_active', true)
    .eq('item_type', 'fbs')
    .order('code');

  if (error || !data?.length) return FBS_FALLBACK;
  return data;
}

/** Дефолты + переопределения из БД. Цены ФБС подтягиваются из recipes. */
export async function listListingTemplates(): Promise<ListTemplatesResult> {
  const fbsRows = await loadFbsRecipes();
  const concrete = buildDefaultListingTemplates().filter((t) => !t.key.startsWith('fbs_'));
  const defaults: ListingTemplate[] = [...concrete, ...buildFbsListingTemplates(fbsRows)];

  const { data, error } = await supabaseAdmin
    .from('marketplace_listing_templates')
    .select('key, title, description, price, grade')
    .order('key');

  if (error) {
    const missing =
      /does not exist|relation .* does not exist|Could not find the table/i.test(error.message);
    return {
      templates: defaults.map((t) => ({ ...t, is_custom: false, is_builtin: true })),
      persistable: !missing,
      persistError: error.message,
    };
  }

  const defaultKeys = new Set(defaults.map((d) => d.key));
  const byKey = new Map(
    (data || []).map((r) => [r.key, rowToTemplate(r, { is_builtin: defaultKeys.has(r.key) })]),
  );
  const merged: ListingTemplate[] = defaults.map((d) => {
    const custom = byKey.get(d.key);
    if (!custom) return { ...d, is_custom: false, is_builtin: true };
    byKey.delete(d.key);
    return { ...custom, is_builtin: true };
  });

  // Пользовательские ключи, которых нет в дефолтах
  for (const extra of byKey.values()) {
    merged.push({ ...extra, is_builtin: false, is_custom: true });
  }

  return { templates: merged, persistable: true };
}

export async function getListingTemplate(key: string): Promise<ListingTemplate | undefined> {
  const { templates } = await listListingTemplates();
  return templates.find((t) => t.key === key);
}

export type SaveTemplateInput = {
  key: string;
  title: string;
  description: string;
  price: number;
  grade?: string | null;
};

export async function saveListingTemplate(input: SaveTemplateInput): Promise<ListingTemplate> {
  const key = input.key.trim();
  if (!key) throw new Error('Укажите ключ шаблона');
  if (!/^[a-zA-Z0-9_\-]+$/.test(key)) {
    throw new Error('Ключ: только латиница, цифры, _ и -');
  }
  const title = input.title.trim();
  const description = input.description.trim();
  const price = Number(input.price);
  if (!title) throw new Error('Укажите название');
  if (!description) throw new Error('Укажите текст объявления');
  if (!Number.isFinite(price) || price < 0) throw new Error('Некорректная цена');

  const { data, error } = await supabaseAdmin
    .from('marketplace_listing_templates')
    .upsert(
      {
        key,
        title,
        description,
        price,
        grade: input.grade?.trim() || null,
      },
      { onConflict: 'key' },
    )
    .select('key, title, description, price, grade')
    .single();

  if (error) throw new Error(error.message);
  const listed = await listListingTemplates();
  return listed.templates.find((t) => t.key === key) ?? rowToTemplate(data, { is_builtin: false });
}

export type DeleteTemplateResult = {
  /** Шаблон снова в списке (сброс к дефолту) */
  template: ListingTemplate | null;
  /** Полностью удалён пользовательский шаблон */
  deleted: boolean;
  /** Сброшено переопределение дефолта */
  reset: boolean;
};

/**
 * Удалить пользовательский шаблон или сбросить переопределение дефолта.
 * Дефолтные ключи из прайса из списка не исчезают — только возвращаются к исходным текстам/цене.
 */
export async function deleteListingTemplate(key: string): Promise<DeleteTemplateResult> {
  const trimmed = key.trim();
  if (!trimmed) throw new Error('Укажите ключ шаблона');

  const before = await getListingTemplate(trimmed);
  if (!before) throw new Error('Шаблон не найден');

  const { error } = await supabaseAdmin
    .from('marketplace_listing_templates')
    .delete()
    .eq('key', trimmed);

  if (error) throw new Error(error.message);

  const after = await getListingTemplate(trimmed);
  if (after) {
    return { template: after, deleted: false, reset: true };
  }
  return { template: null, deleted: true, reset: false };
}

/** @deprecated используйте deleteListingTemplate */
export async function resetListingTemplate(key: string): Promise<ListingTemplate | null> {
  const result = await deleteListingTemplate(key);
  return result.template;
}
