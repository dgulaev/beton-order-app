import { getAvitoAccessToken, getAvitoUserId } from './auth';

const BASE = 'https://api.avito.ru';

async function avitoFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await getAvitoAccessToken();
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Avito API ${res.status} ${path}: ${text.slice(0, 300)}`);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export type AvitoItem = {
  id: number;
  title?: string;
  price?: number;
  status?: string;
  url?: string;
  description?: string;
  category?: { name?: string; id?: number };
  /** Иногда объект, иногда строка — нормализуем в avitoItemToListing. */
  address?: { city?: string; address?: string } | string;
  location?: { address?: string; city?: string };
  city?: string;
  stats?: { views?: number; contacts?: number };
};

export type AvitoItemStats = {
  views: number;
  contacts: number;
  favorites: number;
};

export async function fetchAvitoItems(): Promise<AvitoItem[]> {
  // Items API v1 — список объявлений (без текста и без нормальной статистики)
  const data = await avitoFetch<{ resources?: AvitoItem[] }>(
    `/core/v1/items?per_page=50&page=1&status=active,old,rejected,blocked,removed`,
  );
  return data.resources ?? [];
}

/** Детали объявления: статус/url/vas — текста объявления в API нет. */
export async function fetchAvitoItemInfo(itemId: string | number): Promise<AvitoItem | null> {
  const userId = getAvitoUserId();
  if (!userId) throw new Error('AVITO_USER_ID не задан');
  try {
    const data = await avitoFetch<AvitoItem>(
      `/core/v1/accounts/${userId}/items/${itemId}/`,
    );
    return data ?? null;
  } catch {
    return null;
  }
}

/**
 * Статистика просмотров/контактов (Items list их не отдаёт).
 * POST /stats/v1/accounts/{user_id}/items — суммируем uniq_* за период.
 */
export async function fetchAvitoItemsStats(
  itemIds: Array<string | number>,
): Promise<Map<string, AvitoItemStats>> {
  const userId = getAvitoUserId();
  if (!userId) throw new Error('AVITO_USER_ID не задан');

  const ids = [...new Set(itemIds.map((id) => Number(id)).filter((n) => Number.isFinite(n)))];
  const out = new Map<string, AvitoItemStats>();
  if (ids.length === 0) return out;

  const dateTo = new Date();
  const dateFrom = new Date();
  dateFrom.setUTCDate(dateFrom.getUTCDate() - 269);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  // Батчи по 200 (лимит Авито)
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    try {
      const data = await avitoFetch<{
        result?: {
          items?: Array<{
            item_id?: number;
            itemId?: number;
            stats?: Array<{
              uniq_views?: number;
              uniqViews?: number;
              views?: number;
              uniq_contacts?: number;
              uniqContacts?: number;
              contacts?: number;
              uniq_favorites?: number;
              uniqFavorites?: number;
              favorites?: number;
            }>;
          }>;
        };
      }>(`/stats/v1/accounts/${userId}/items`, {
        method: 'POST',
        body: JSON.stringify({
          date_from: fmt(dateFrom),
          date_to: fmt(dateTo),
          item_ids: chunk,
          fields: ['uniqViews', 'uniqContacts', 'uniqFavorites'],
          period_grouping: 'day',
        }),
      });

      for (const row of data.result?.items || []) {
        const id = row.item_id ?? row.itemId;
        if (id == null) continue;
        let views = 0;
        let contacts = 0;
        let favorites = 0;
        for (const s of row.stats || []) {
          views += Number(s.uniq_views ?? s.uniqViews ?? s.views ?? 0) || 0;
          contacts += Number(s.uniq_contacts ?? s.uniqContacts ?? s.contacts ?? 0) || 0;
          favorites += Number(s.uniq_favorites ?? s.uniqFavorites ?? s.favorites ?? 0) || 0;
        }
        out.set(String(id), { views, contacts, favorites });
      }
    } catch (e) {
      console.error('[avito] stats', e);
    }
  }

  return out;
}

export type AvitoChatMessage = {
  id: string;
  created?: number;
  type?: string;
  content?: { text?: string };
  author_id?: number;
  direction?: 'in' | 'out';
};

export type AvitoChat = {
  id: string;
  created?: number;
  updated?: number;
  users?: Array<{ id: number; name?: string; public_user_profile?: { url?: string } }>;
  context?: { type?: string; value?: { id?: number; title?: string; url?: string } };
  last_message?: AvitoChatMessage;
};

export async function fetchAvitoChats(options?: {
  unreadOnly?: boolean;
  itemIds?: Array<string | number>;
  limit?: number;
}): Promise<AvitoChat[]> {
  const userId = getAvitoUserId();
  if (!userId) throw new Error('AVITO_USER_ID не задан');

  const params = new URLSearchParams();
  if (options?.unreadOnly) params.set('unread_only', 'true');
  if (options?.limit) params.set('limit', String(options.limit));
  for (const id of options?.itemIds || []) {
    params.append('item_ids', String(id));
  }
  const q = params.toString() ? `?${params}` : '';
  const data = await avitoFetch<{ chats?: AvitoChat[] }>(
    `/messenger/v2/accounts/${userId}/chats${q}`,
  );
  return data.chats ?? [];
}

export async function fetchAvitoChatMessages(
  chatId: string,
  options?: { limit?: number; offset?: number },
): Promise<AvitoChatMessage[]> {
  const userId = getAvitoUserId();
  if (!userId) throw new Error('AVITO_USER_ID не задан');

  const params = new URLSearchParams();
  if (options?.limit) params.set('limit', String(options.limit));
  if (options?.offset) params.set('offset', String(options.offset));
  const q = params.toString() ? `?${params}` : '';

  const data = await avitoFetch<{ messages?: AvitoChatMessage[] }>(
    `/messenger/v3/accounts/${userId}/chats/${encodeURIComponent(chatId)}/messages/${q}`,
  );
  return data.messages ?? [];
}

export async function sendAvitoMessage(chatId: string, text: string): Promise<unknown> {
  const userId = getAvitoUserId();
  if (!userId) throw new Error('AVITO_USER_ID не задан');
  const trimmed = text.trim();
  if (!trimmed) throw new Error('Пустое сообщение');
  if (trimmed.length > 1000) throw new Error('Сообщение длиннее 1000 символов');

  return avitoFetch(
    `/messenger/v1/accounts/${userId}/chats/${encodeURIComponent(chatId)}/messages`,
    {
      method: 'POST',
      body: JSON.stringify({ type: 'text', message: { text: trimmed } }),
    },
  );
}

export async function markAvitoChatRead(chatId: string): Promise<void> {
  const userId = getAvitoUserId();
  if (!userId) throw new Error('AVITO_USER_ID не задан');
  await avitoFetch(
    `/messenger/v1/accounts/${userId}/chats/${encodeURIComponent(chatId)}/read`,
    { method: 'POST' },
  );
}

export async function subscribeAvitoWebhook(url: string): Promise<void> {
  // Официально: POST /messenger/v3/webhook { url }
  await avitoFetch('/messenger/v3/webhook', {
    method: 'POST',
    body: JSON.stringify({ url }),
  });
}

export async function listAvitoWebhookSubscriptions(): Promise<
  Array<{ url?: string; version?: string | number }>
> {
  // Важно: метод POST (без тела). GET на этот путь даёт 404 "route not found".
  const data = await avitoFetch<{ subscriptions?: Array<{ url?: string; version?: string | number }> }>(
    '/messenger/v1/subscriptions',
    { method: 'POST', body: '{}' },
  );
  return data.subscriptions ?? [];
}

/** Человекочитаемая подсказка по ошибкам Messenger webhook. */
export function explainAvitoMessengerError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('402') || m.includes('подписк')) {
    return (
      `${message} · Для Товаров Messenger API нужен тариф «Максимальный» ` +
      `(или отдельная подписка API мессенджера).`
    );
  }
  if (m.includes('403') || m.includes('forbidden') || m.includes('invalid access token')) {
    return (
      `${message} · Проверь у приложения scopes messenger:read / messenger:write ` +
      `и что webhook URL — публичный https (не localhost). ` +
      `В Товарах часто нужен тариф «Максимальный».`
    );
  }
  if (m.includes('404') && m.includes('subscriptions')) {
    return `${message} · Список подписок вызывается методом POST, не GET.`;
  }
  return message;
}

export async function updateAvitoItemPrice(itemId: string | number, price: number): Promise<void> {
  const userId = getAvitoUserId();
  if (!userId) throw new Error('AVITO_USER_ID не задан');
  await avitoFetch(`/core/v1/items/${itemId}/update_price`, {
    method: 'POST',
    body: JSON.stringify({ price }),
  });
}
