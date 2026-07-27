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
};

const ZONE = 'Брянск и область';
const MIN_VOLUME = CONCRETE_CONFIG.limits.minVolume;

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

  return [service, ...byGrade];
}

/** @deprecated используйте buildDefaultListingTemplates / listListingTemplates */
export function buildListingTemplates(): ListingTemplate[] {
  return buildDefaultListingTemplates();
}

function rowToTemplate(row: {
  key: string;
  title: string;
  description: string;
  price: number | string;
  grade?: string | null;
}): ListingTemplate {
  return {
    key: row.key,
    title: row.title,
    description: row.description,
    price: Number(row.price),
    grade: row.grade || undefined,
    is_custom: true,
  };
}

export type ListTemplatesResult = {
  templates: ListingTemplate[];
  /** false — таблица ещё не создана в Supabase */
  persistable: boolean;
  persistError?: string;
};

/** Дефолты + переопределения из БД. */
export async function listListingTemplates(): Promise<ListTemplatesResult> {
  const defaults = buildDefaultListingTemplates();
  const { data, error } = await supabaseAdmin
    .from('marketplace_listing_templates')
    .select('key, title, description, price, grade')
    .order('key');

  if (error) {
    const missing =
      /does not exist|relation .* does not exist|Could not find the table/i.test(error.message);
    return {
      templates: defaults.map((t) => ({ ...t, is_custom: false })),
      persistable: !missing,
      persistError: error.message,
    };
  }

  const byKey = new Map((data || []).map((r) => [r.key, rowToTemplate(r)]));
  const merged: ListingTemplate[] = defaults.map((d) => {
    const custom = byKey.get(d.key);
    if (!custom) return { ...d, is_custom: false };
    byKey.delete(d.key);
    return custom;
  });

  // Пользовательские ключи, которых нет в дефолтах
  for (const extra of byKey.values()) merged.push(extra);

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
  return rowToTemplate(data);
}

/** Удалить переопределение — вернётся дефолт из кода (если был). */
export async function resetListingTemplate(key: string): Promise<ListingTemplate | null> {
  const { error } = await supabaseAdmin
    .from('marketplace_listing_templates')
    .delete()
    .eq('key', key);

  if (error) throw new Error(error.message);

  const defaults = buildDefaultListingTemplates();
  const fallback = defaults.find((t) => t.key === key);
  return fallback ? { ...fallback, is_custom: false } : null;
}
