/** Русские подписи источников Demand Radar для UI и нотисов */
export const DEMAND_SOURCE_LABEL: Record<string, string> = {
  demo: 'Демо',
  feed: 'Лента',
  gosplan: 'ГосПлан',
  tender: 'Тендер',
  avito: 'Авито',
};

export function demandSourceLabel(source: string | null | undefined): string {
  if (!source) return 'Спрос';
  return DEMAND_SOURCE_LABEL[source] || source;
}
