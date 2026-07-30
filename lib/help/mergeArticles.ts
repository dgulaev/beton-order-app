import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { DEFAULT_HELP_ARTICLES, getDefaultHelpArticle } from './defaultArticles';
import type { HelpArticle, HelpBlock } from './types';

type HelpArticleRow = {
  id: string;
  title: string;
  summary: string | null;
  roles: unknown;
  route: string | null;
  routes: unknown;
  body: unknown;
};

const HELP_ROLES = new Set([
  'admin',
  'manager',
  'dispatcher',
  'operator',
  'laborant',
  'guest',
  'driver',
]);

function rolesOk(raw: unknown): boolean {
  if (raw === undefined) return true;
  return Array.isArray(raw) && raw.every((r) => typeof r === 'string' && HELP_ROLES.has(r));
}

function isHelpBlock(raw: unknown): raw is HelpBlock {
  if (!raw || typeof raw !== 'object') return false;
  const b = raw as Record<string, unknown>;
  if (!rolesOk(b.roles)) return false;
  if (b.type === 'h2' || b.type === 'h3' || b.type === 'p') {
    return typeof b.text === 'string';
  }
  if (b.type === 'ol' || b.type === 'ul') {
    return Array.isArray(b.items) && b.items.every((i) => typeof i === 'string');
  }
  if (b.type === 'callout') {
    return (
      (b.tone === 'tip' || b.tone === 'warn') &&
      typeof b.text === 'string'
    );
  }
  return false;
}

function parseBody(raw: unknown, fallback: HelpBlock[]): HelpBlock[] {
  if (!Array.isArray(raw)) return fallback;
  const body = raw.filter(isHelpBlock);
  return body.length ? body : fallback;
}

export function rowToArticle(row: HelpArticleRow, fallback?: HelpArticle): HelpArticle | null {
  const base = fallback ?? getDefaultHelpArticle(row.id);
  if (!base) return null;
  return {
    id: row.id,
    title: typeof row.title === 'string' && row.title.trim() ? row.title.trim() : base.title,
    summary: typeof row.summary === 'string' ? row.summary : base.summary,
    // roles/route всегда из дефолта — в UI не редактируются
    roles: base.roles,
    route: base.route,
    routes: base.routes,
    body: parseBody(row.body, base.body),
  };
}

export function mergeHelpArticles(overrides: HelpArticleRow[]): {
  articles: HelpArticle[];
  overrideIds: string[];
} {
  const byId = new Map(overrides.map((r) => [r.id, r]));
  const overrideIds: string[] = [];
  const articles = DEFAULT_HELP_ARTICLES.map((def) => {
    const row = byId.get(def.id);
    if (!row) return def;
    overrideIds.push(def.id);
    return rowToArticle(row, def) ?? def;
  });
  return { articles, overrideIds };
}

/** Таблица ещё не создана или PostgREST не подхватил схему (schema cache). */
export function isHelpArticlesUnavailableError(message: string | undefined | null): boolean {
  if (!message) return false;
  return (
    /relation .*help_articles.* does not exist/i.test(message) ||
    /could not find the table ['"]?public\.help_articles/i.test(message) ||
    /schema cache/i.test(message)
  );
}

export async function loadMergedHelpArticles(): Promise<{
  articles: HelpArticle[];
  overrideIds: string[];
  tableMissing?: boolean;
}> {
  const { data, error } = await supabaseAdmin
    .from('help_articles')
    .select('id, title, summary, roles, route, routes, body');

  if (error) {
    if (isHelpArticlesUnavailableError(error.message)) {
      console.error('[help-articles] table unavailable:', error.message);
      return {
        articles: DEFAULT_HELP_ARTICLES,
        overrideIds: [],
        tableMissing: true,
      };
    }
    console.error('[help-articles] load failed:', error.message);
    return { articles: DEFAULT_HELP_ARTICLES, overrideIds: [] };
  }

  return mergeHelpArticles((data || []) as HelpArticleRow[]);
}

/** Валидация тела для PUT: только известный id; roles/route из дефолта. */
export function buildArticleForUpsert(input: unknown):
  | { article: HelpArticle; error?: undefined }
  | { article?: undefined; error: string } {
  if (!input || typeof input !== 'object') {
    return { error: 'Нужен объект article' };
  }
  const raw = input as Record<string, unknown>;
  const id = typeof raw.id === 'string' ? raw.id : '';
  const def = getDefaultHelpArticle(id);
  if (!def) {
    return { error: 'Неизвестный id статьи — можно править только существующие инструкции' };
  }
  const title = typeof raw.title === 'string' ? raw.title.trim() : '';
  if (!title) return { error: 'Заголовок обязателен' };
  const summary = typeof raw.summary === 'string' ? raw.summary : '';
  if (!Array.isArray(raw.body) || !raw.body.every(isHelpBlock)) {
    return { error: 'Некорректное тело статьи (body)' };
  }
  return {
    article: {
      id: def.id,
      title,
      summary,
      roles: def.roles,
      route: def.route,
      routes: def.routes,
      body: raw.body as HelpBlock[],
    },
  };
}
