import { DEFAULT_HELP_ARTICLES } from './defaultArticles';
import type { HelpArticle, HelpRole } from './types';

const ONBOARDING_BY_ROLE: Partial<Record<HelpRole, string[]>> = {
  laborant: ['laborant-intro', 'recipes'],
  operator: ['operator-intro', 'operator'],
  dispatcher: ['ops-intro', 'dashboard', 'zayavki', 'sales', 'mixers'],
  manager: ['ops-intro', 'dashboard', 'zayavki', 'sales', 'mixers'],
  driver: ['driver-intro', 'driver'],
};

export const HELP_ENABLED_ROLES: HelpRole[] = [
  'laborant',
  'operator',
  'dispatcher',
  'manager',
  'admin',
  'driver',
];

/** Кэш смерженных статей (после fetch из API). Пока null — дефолты из кода. */
let runtimeArticles: HelpArticle[] | null = null;

export function setRuntimeHelpArticles(articles: HelpArticle[] | null): void {
  runtimeArticles = articles;
}

export function getAllHelpArticles(): HelpArticle[] {
  return runtimeArticles ?? DEFAULT_HELP_ARTICLES;
}

export function isHelpEnabledForRole(role: string | null | undefined): boolean {
  if (!role) return false;
  return HELP_ENABLED_ROLES.includes(role as HelpRole);
}

export function hasHelpOnboarding(role: string | null | undefined): boolean {
  if (!role) return false;
  return (ONBOARDING_BY_ROLE[role as HelpRole]?.length ?? 0) > 0;
}

export function getHelpArticle(id: string): HelpArticle | undefined {
  return getAllHelpArticles().find((a) => a.id === id);
}

export function listHelpArticlesForRole(role: string | null | undefined): HelpArticle[] {
  if (!role) return [];
  const r = role as HelpRole;
  return getAllHelpArticles().filter((a) => a.roles.includes(r));
}

function articleMatchesPath(article: HelpArticle, pathname: string): boolean {
  const routes =
    article.routes ?? (article.route ? [article.route] : []);
  return routes.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
}

export function getHelpArticleForRoute(
  pathname: string,
  role: string | null | undefined,
): HelpArticle | undefined {
  if (!role) return undefined;
  const r = role as HelpRole;
  return getAllHelpArticles().find(
    (a) => a.roles.includes(r) && articleMatchesPath(a, pathname),
  );
}

export function getOnboardingArticleIds(role: string | null | undefined): string[] {
  if (!role) return [];
  return ONBOARDING_BY_ROLE[role as HelpRole] ?? [];
}

export function getOnboardingArticles(role: string | null | undefined): HelpArticle[] {
  return getOnboardingArticleIds(role)
    .map((id) => getHelpArticle(id))
    .filter((a): a is HelpArticle => !!a);
}
