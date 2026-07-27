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
  category?: { name?: string };
  address?: { city?: string };
  stats?: { views?: number; contacts?: number };
};

export async function fetchAvitoItems(): Promise<AvitoItem[]> {
  const userId = getAvitoUserId();
  if (!userId) throw new Error('AVITO_USER_ID не задан');

  // Items API v1 — список объявлений пользователя
  const data = await avitoFetch<{ resources?: AvitoItem[] }>(
    `/core/v1/items?per_page=50&page=1&status=active,old,rejected,blocked,removed`,
  );
  return data.resources ?? [];
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

export async function fetchAvitoChats(unreadOnly = false): Promise<AvitoChat[]> {
  const userId = getAvitoUserId();
  if (!userId) throw new Error('AVITO_USER_ID не задан');

  const q = unreadOnly ? '?unread_only=true' : '';
  const data = await avitoFetch<{ chats?: AvitoChat[] }>(
    `/messenger/v2/accounts/${userId}/chats${q}`,
  );
  return data.chats ?? [];
}

export async function fetchAvitoChatMessages(chatId: string): Promise<AvitoChatMessage[]> {
  const userId = getAvitoUserId();
  if (!userId) throw new Error('AVITO_USER_ID не задан');

  const data = await avitoFetch<{ messages?: AvitoChatMessage[] }>(
    `/messenger/v3/accounts/${userId}/chats/${chatId}/messages/`,
  );
  return data.messages ?? [];
}

export async function subscribeAvitoWebhook(url: string): Promise<void> {
  await avitoFetch('/messenger/v3/webhook', {
    method: 'POST',
    body: JSON.stringify({ url }),
  });
}

export async function updateAvitoItemPrice(itemId: string | number, price: number): Promise<void> {
  const userId = getAvitoUserId();
  if (!userId) throw new Error('AVITO_USER_ID не задан');
  await avitoFetch(`/core/v1/items/${itemId}/update_price`, {
    method: 'POST',
    body: JSON.stringify({ price }),
  });
}
