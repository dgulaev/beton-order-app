import { laborantIntroArticle } from './articles/laborantIntro';
import { recipesArticle } from './articles/recipes';
import { operatorIntroArticle } from './articles/operatorIntro';
import { operatorArticle } from './articles/operator';
import { opsIntroArticle } from './articles/opsIntro';
import { dashboardArticle } from './articles/dashboard';
import { zayavkiArticle } from './articles/zayavki';
import { salesArticle } from './articles/sales';
import { mixersArticle } from './articles/mixers';
import { planningArticle } from './articles/planning';
import { driverIntroArticle } from './articles/driverIntro';
import { driverArticle } from './articles/driver';
import type { HelpArticle } from './types';

/** Статические дефолты справки. БД может переопределить title/summary/body по id. */
export const DEFAULT_HELP_ARTICLES: HelpArticle[] = [
  laborantIntroArticle,
  recipesArticle,
  operatorIntroArticle,
  operatorArticle,
  opsIntroArticle,
  dashboardArticle,
  zayavkiArticle,
  planningArticle,
  salesArticle,
  mixersArticle,
  driverIntroArticle,
  driverArticle,
];

export function getDefaultHelpArticle(id: string): HelpArticle | undefined {
  return DEFAULT_HELP_ARTICLES.find((a) => a.id === id);
}
