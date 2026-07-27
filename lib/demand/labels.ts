/** Русские подписи источников Demand Radar для UI и нотисов */
export const DEMAND_SOURCE_LABEL: Record<string, string> = {
  demo: 'Демо',
  feed: 'JSON-лента',
  gosplan: 'ГосПлан / ЕИС',
  gosplan44: '44-ФЗ',
  gosplan223: '223-ФЗ',
  tender: 'Тендер',
  avito: 'Авито',
  avito_messenger: 'Авито · чат',
};

export function demandSourceLabel(source: string | null | undefined): string {
  if (!source) return 'Спрос';
  return DEMAND_SOURCE_LABEL[source] || source;
}

export const DEMAND_STATUS_LABEL: Record<string, string> = {
  new: 'Новый',
  relevant: 'Релевантный',
  processing: 'Обработка',
  taken: 'В лидах',
  ignored: 'Игнор',
};
