export type IntegrationKind = 'marketplace' | 'demand' | 'other';

export type IntegrationPreset = {
  key: string;
  title: string;
  kind: IntegrationKind;
  /** Краткая инструкция для менеджера */
  managerGuide: string;
  /** Что положить в credentials_hint (для разработчика) */
  credentialsHint: string;
  docsUrl?: string;
};

/** Пресеты «добавить площадку» — без реальных ключей, только ТЗ. */
export const INTEGRATION_PRESETS: IntegrationPreset[] = [
  {
    key: 'youla',
    title: 'Юла',
    kind: 'marketplace',
    docsUrl: 'https://youla.ru/',
    managerGuide:
      'Нужен доступ к API/кабинету продавца. Укажи логин кабинета или ID продавца в «Данные аккаунта». Секреты в форму не вставляй — их добавит разработчик.',
    credentialsHint: [
      'YOULA_CLIENT_ID=',
      'YOULA_CLIENT_SECRET=',
      'YOULA_USER_ID=',
      'YOULA_WEBHOOK_SECRET=',
      '',
      'Adapter: lib/integrations/youla/',
      'Регистрация: lib/integrations/registerAll.ts',
      'Webhook: /api/webhooks/youla',
    ].join('\n'),
  },
  {
    key: 'cian',
    title: 'ЦИАН',
    kind: 'marketplace',
    docsUrl: 'https://www.cian.ru/',
    managerGuide:
      'Обычно нужен API-ключ партнёра и ID объявлений/аккаунта. Опиши в заметках, какие разделы ЦИАН используем (объявления / сообщения).',
    credentialsHint: [
      'CIAN_API_KEY=',
      'CIAN_ACCOUNT_ID=',
      '',
      'Adapter: lib/integrations/cian/',
      'Регистрация: lib/integrations/registerAll.ts',
    ].join('\n'),
  },
  {
    key: 'avito_extra',
    title: 'Авито (второй кабинет)',
    kind: 'marketplace',
    docsUrl: 'https://developers.avito.ru/',
    managerGuide:
      'Если нужен ещё один аккаунт Авито — укажи Client ID / User ID в заметках (Secret не пиши в чат). Разработчик вынесет мультиаккаунт в код.',
    credentialsHint: [
      'AVITO_2_CLIENT_ID=',
      'AVITO_2_CLIENT_SECRET=',
      'AVITO_2_USER_ID=',
      'AVITO_2_WEBHOOK_SECRET=',
      '',
      'Сейчас в коде один кабинет (AVITO_*). Второй = отдельный adapter или расширение auth.',
    ].join('\n'),
  },
  {
    key: 'demand_feed',
    title: 'Своя JSON-лента спроса',
    kind: 'demand',
    managerGuide:
      'Укажи URL ленты (или кто её отдаёт). Формат: массив { id, title, body?, url?, region?, published_at? }. Секрет авторизации ленты — разработчику отдельно.',
    credentialsHint: [
      'DEMAND_FEED_URL=https://…',
      '# при необходимости: заголовок Authorization в feedCollector',
      '',
      'UI: страница Интеграции → Спрос → JSON-лента',
    ].join('\n'),
  },
  {
    key: 'custom',
    title: 'Другая площадка',
    kind: 'other',
    managerGuide:
      'Напиши название, ссылку на кабинет/API и что нужно: объявления, чаты, тендеры. Поля ключей оставь пустыми — их заведут в коде после ТЗ.',
    credentialsHint: [
      'SOURCE_CLIENT_ID=',
      'SOURCE_CLIENT_SECRET=',
      'SOURCE_WEBHOOK_SECRET=',
      '',
      '1) MarketplaceAdapter (source = source_key)',
      '2) registerAllMarketplaceAdapters()',
      '3) webhook route при необходимости',
      '4) env или integration_settings',
    ].join('\n'),
  },
];

export const INTEGRATION_STATUS_LABEL: Record<string, string> = {
  requested: 'Заявка',
  in_progress: 'В работе',
  wired: 'Подключено',
  cancelled: 'Отменено',
};

export const INTEGRATION_KIND_LABEL: Record<IntegrationKind, string> = {
  marketplace: 'Площадка',
  demand: 'Спрос',
  other: 'Прочее',
};

/** source_key: латиница, цифры, _ */
export function normalizeSourceKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 48);
}
