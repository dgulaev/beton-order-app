import {
  extractLeadFields,
  isLikelySpam,
  scoreLeadText,
  type LeadDraft,
} from '@/lib/leads';
import type { MarketplaceListingDraft } from '@/lib/integrations/marketplaceAdapter';
import type { AvitoChat, AvitoItem } from './client';

function extractCity(item: AvitoItem): string | null {
  if (typeof item.city === 'string' && item.city.trim()) return item.city.trim();
  if (typeof item.address === 'string' && item.address.trim()) {
    // Часто «Брянск, …» или просто город
    return item.address.split(',')[0]?.trim() || item.address.trim();
  }
  if (item.address && typeof item.address === 'object') {
    const city = item.address.city?.trim();
    if (city) return city;
    const addr = item.address.address?.trim();
    if (addr) return addr.split(',')[0]?.trim() || addr;
  }
  if (item.location?.city?.trim()) return item.location.city.trim();
  if (item.location?.address?.trim()) {
    return item.location.address.split(',')[0]?.trim() || item.location.address.trim();
  }
  return null;
}

export function avitoItemToListing(item: AvitoItem): MarketplaceListingDraft {
  return {
    source: 'avito',
    external_id: String(item.id),
    title: item.title ?? null,
    // Текст объявления Items API не отдаёт — только локально / из шаблона.
    description: item.description?.trim() ? item.description : null,
    price: item.price ?? null,
    status: item.status ?? 'active',
    url: item.url ?? `https://www.avito.ru/item/${item.id}`,
    category: item.category?.name ?? null,
    city: extractCity(item),
    views: item.stats?.views ?? 0,
    contacts: item.stats?.contacts ?? 0,
    raw_payload: item as unknown as Record<string, unknown>,
  };
}

export function avitoChatToLead(chat: AvitoChat): LeadDraft | null {
  const msg = chat.last_message;
  if (!msg || msg.direction === 'out') return null;

  // Стабильный id обязателен — иначе при polling появятся дубли.
  const stableMsgId = msg.id || (msg.created != null ? String(msg.created) : '');
  if (!chat.id || !stableMsgId) return null;

  const text = msg.content?.text?.trim() || '';
  const buyer = (chat.users || []).find((u) => u.id !== Number(process.env.AVITO_USER_ID));
  const item = chat.context?.type === 'item' ? chat.context.value : undefined;
  const externalId = `${chat.id}:${stableMsgId}`;

  if (isLikelySpam(text)) {
    return {
      source: 'avito',
      external_id: externalId,
      status: 'spam',
      raw_text: text,
      name: buyer?.name ?? null,
      chat_url: `https://www.avito.ru/profile/messenger/channel/${chat.id}`,
      listing_id: item?.id != null ? String(item.id) : null,
      raw_payload: chat as unknown as Record<string, unknown>,
      score: 0,
    };
  }

  const extracted = extractLeadFields(text);
  return {
    source: 'avito',
    external_id: externalId,
    status: 'new',
    raw_text: text || item?.title || 'Сообщение из Авито',
    name: buyer?.name ?? null,
    phone: extracted.phone ?? null,
    chat_url: `https://www.avito.ru/profile/messenger/channel/${chat.id}`,
    listing_id: item?.id != null ? String(item.id) : null,
    grade: extracted.grade ?? null,
    volume_m3: extracted.volume_m3 ?? null,
    score: extracted.score ?? scoreLeadText(text),
    raw_payload: chat as unknown as Record<string, unknown>,
  };
}

/** Нормализация webhook payload Авито Messenger (несколько возможных форм). */
export function normalizeAvitoWebhookPayload(body: unknown): LeadDraft[] {
  if (!body || typeof body !== 'object') return [];
  const payload = body as Record<string, unknown>;

  // Формат: { payload: { value: { chat_id, content: { text }, ... } } }
  const value =
    (payload.payload as Record<string, unknown> | undefined)?.value ||
    payload.value ||
    payload;

  if (!value || typeof value !== 'object') return [];
  const v = value as Record<string, unknown>;

  const chatId = String(v.chat_id || v.chatId || (v.chat as { id?: string } | undefined)?.id || '');
  // Только стабильные ключи с площадки. Date.now() запрещён — retry webhook = дубли.
  const messageIdRaw =
    v.id ??
    v.message_id ??
    v.messageId ??
    v.created ??
    (v.content as { created?: number | string } | undefined)?.created;
  const messageId = messageIdRaw != null && String(messageIdRaw).trim() !== ''
    ? String(messageIdRaw)
    : '';
  const text =
    (v.content as { text?: string } | undefined)?.text ||
    (typeof v.text === 'string' ? v.text : '') ||
    '';
  const authorName =
    (v.author as { name?: string } | undefined)?.name ||
    (v.user as { name?: string } | undefined)?.name ||
    null;
  const itemId = v.item_id || (v.item as { id?: number } | undefined)?.id;

  // Исходящие сообщения менеджера не создаём как лиды.
  // В webhook часто есть author_id без direction — без этой проверки свои ответы = ложные лиды.
  const authorId =
    v.author_id ??
    (v.author as { id?: number } | undefined)?.id ??
    (v.user as { id?: number } | undefined)?.id;
  const ourUserId = Number(process.env.AVITO_USER_ID);
  if (Number.isFinite(ourUserId) && authorId != null && Number(authorId) === ourUserId) {
    return [];
  }
  const direction = v.direction || (v.type === 'system' ? 'out' : 'in');
  if (direction === 'out') return [];

  if (!chatId || !messageId) {
    console.warn('[avito] skip webhook: нет chat_id или стабильного message id');
    return [];
  }

  const externalId = `${chatId}:${messageId}`;
  if (isLikelySpam(text)) {
    return [{
      source: 'avito',
      external_id: externalId,
      status: 'spam',
      raw_text: text,
      name: authorName,
      chat_url: chatId ? `https://www.avito.ru/profile/messenger/channel/${chatId}` : null,
      listing_id: itemId != null ? String(itemId) : null,
      raw_payload: payload,
      score: 0,
    }];
  }

  const extracted = extractLeadFields(text);
  return [{
    source: 'avito',
    external_id: externalId,
    status: 'new',
    raw_text: text || 'Сообщение из Авито',
    name: authorName,
    phone: extracted.phone ?? null,
    chat_url: chatId ? `https://www.avito.ru/profile/messenger/channel/${chatId}` : null,
    listing_id: itemId != null ? String(itemId) : null,
    grade: extracted.grade ?? null,
    volume_m3: extracted.volume_m3 ?? null,
    score: extracted.score ?? scoreLeadText(text),
    raw_payload: payload,
  }];
}
