import {
  extractLeadFields,
  isLikelySpam,
  scoreLeadText,
  type LeadDraft,
} from '@/lib/leads';
import type { DemandDraft } from '@/lib/demand/collectors/types';
import type { MarketplaceListingDraft } from '@/lib/integrations/marketplaceAdapter';
import { peekIntegrationSettings } from '@/lib/integrations/settings';
import { sanitizeAvitoMessageText } from './messageText';
import type { AvitoChat, AvitoItem } from './client';

function avitoDemandExternalId(chatId: string, messageId: string): string {
  return `avito-chat:${chatId}:${messageId}`;
}

function buildAvitoDemandDraft(input: {
  chatId: string;
  messageId: string;
  text: string;
  authorName: string | null;
  itemId: string | number | null | undefined;
  itemTitle?: string | null;
  itemUrl?: string | null;
  publishedAt?: string | null;
  rawPayload: Record<string, unknown>;
}): DemandDraft {
  const text = sanitizeAvitoMessageText(input.text);
  const bodyText = text || 'Текст в Авито — откройте чат на площадке';
  const title = input.itemTitle
    ? `Авито · ${input.itemTitle}`
    : input.authorName
      ? `Авито · ${input.authorName}`
      : 'Запрос из чата Авито';
  const chatUrl = `https://www.avito.ru/profile/messenger/channel/${input.chatId}`;
  const enriched = extractLeadFields(text);
  const grades = enriched.grade ? [enriched.grade] : null;
  const likelySpam = text ? isLikelySpam(text) : false;

  return {
    source: 'avito',
    external_id: avitoDemandExternalId(input.chatId, input.messageId),
    // В лид уходит как chat_url/etp_url — нужна ссылка на мессенджер, не на объявление.
    external_url: chatUrl,
    title,
    body: [
      input.authorName ? `От: ${input.authorName}` : null,
      bodyText,
      input.itemTitle ? `Объявление: ${input.itemTitle}` : null,
    ]
      .filter(Boolean)
      .join('\n\n'),
    region: null,
    published_at: input.publishedAt ?? new Date().toISOString(),
    volume_m3: enriched.volume_m3 ?? null,
    grades,
    delivery_needed: null,
    buyer_type: 'b2c',
    // Спам всё равно в Спрос (менеджер решит), но без пуша/тоста.
    force_notify: !likelySpam,
    raw_payload: {
      ...input.rawPayload,
      legal: 'messenger_only',
      chat_id: input.chatId,
      message_id: input.messageId,
      listing_id: input.itemId != null ? String(input.itemId) : null,
      item_url: input.itemUrl ?? null,
      chat_url: chatUrl,
      likely_spam: likelySpam,
    },
  };
}

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

  const text = sanitizeAvitoMessageText(msg.content?.text);
  const ourUserIdSync = Number(peekIntegrationSettings().avito.userId);
  const buyer = (chat.users || []).find((u) => u.id !== ourUserIdSync);
  const item = chat.context?.type === 'item' ? chat.context.value : undefined;
  const externalId = `${chat.id}:${stableMsgId}`;

  if (text && isLikelySpam(text)) {
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
    raw_text: text || 'Откройте чат в Авито',
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

/** Непрочитанный чат → черновик Спроса (fallback cron / webhook-путь). */
export function avitoChatToDemand(chat: AvitoChat): DemandDraft | null {
  const msg = chat.last_message;
  if (!msg || msg.direction === 'out') return null;

  const stableMsgId = msg.id || (msg.created != null ? String(msg.created) : '');
  if (!chat.id || !stableMsgId) return null;

  const ourUserIdSync = Number(peekIntegrationSettings().avito.userId);
  const buyer = (chat.users || []).find((u) => u.id !== ourUserIdSync);
  const item = chat.context?.type === 'item' ? chat.context.value : undefined;
  const text = msg.content?.text?.trim() || '';

  return buildAvitoDemandDraft({
    chatId: chat.id,
    messageId: stableMsgId,
    text,
    authorName: buyer?.name ?? null,
    itemId: item?.id,
    itemTitle: item?.title ?? null,
    itemUrl: item?.url ?? null,
    publishedAt: msg.created
      ? new Date(msg.created * (msg.created < 2e10 ? 1000 : 1)).toISOString()
      : null,
    rawPayload: chat as unknown as Record<string, unknown>,
  });
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
  const text = sanitizeAvitoMessageText(
    (v.content as { text?: string } | undefined)?.text ||
      (typeof v.text === 'string' ? v.text : '') ||
      '',
  );
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
  const ourUserId = Number(peekIntegrationSettings().avito.userId);
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
  if (text && isLikelySpam(text)) {
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
    raw_text: text || 'Откройте чат в Авито',
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

/**
 * Webhook Messenger → Спрос (не сразу в лиды).
 * Менеджер потом: в работу / отказ / спам.
 */
export function normalizeAvitoWebhookToDemand(body: unknown): DemandDraft[] {
  if (!body || typeof body !== 'object') return [];
  const payload = body as Record<string, unknown>;

  const value =
    (payload.payload as Record<string, unknown> | undefined)?.value ||
    payload.value ||
    payload;

  if (!value || typeof value !== 'object') return [];
  const v = value as Record<string, unknown>;

  const chatId = String(v.chat_id || v.chatId || (v.chat as { id?: string } | undefined)?.id || '');
  const messageIdRaw =
    v.id ??
    v.message_id ??
    v.messageId ??
    v.created ??
    (v.content as { created?: number | string } | undefined)?.created;
  const messageId =
    messageIdRaw != null && String(messageIdRaw).trim() !== '' ? String(messageIdRaw) : '';
  const text = sanitizeAvitoMessageText(
    (v.content as { text?: string } | undefined)?.text ||
      (typeof v.text === 'string' ? v.text : '') ||
      '',
  );
  const authorName =
    (v.author as { name?: string } | undefined)?.name ||
    (v.user as { name?: string } | undefined)?.name ||
    null;
  const itemIdRaw = v.item_id ?? (v.item as { id?: number | string } | undefined)?.id;
  const itemId =
    typeof itemIdRaw === 'string' || typeof itemIdRaw === 'number' ? itemIdRaw : null;
  const itemTitle =
    (v.item as { title?: string } | undefined)?.title ||
    (typeof v.item_title === 'string' ? v.item_title : null);

  const authorId =
    v.author_id ??
    (v.author as { id?: number } | undefined)?.id ??
    (v.user as { id?: number } | undefined)?.id;
  const ourUserId = Number(peekIntegrationSettings().avito.userId);
  if (Number.isFinite(ourUserId) && authorId != null && Number(authorId) === ourUserId) {
    return [];
  }
  const direction = v.direction || (v.type === 'system' ? 'out' : 'in');
  if (direction === 'out') return [];

  if (!chatId || !messageId) {
    console.warn('[avito] skip webhook demand: нет chat_id или стабильного message id');
    return [];
  }

  const createdRaw =
    typeof v.created === 'number'
      ? v.created
      : typeof (v.content as { created?: number } | undefined)?.created === 'number'
        ? (v.content as { created: number }).created
        : null;
  const publishedAt = createdRaw != null
    ? new Date(createdRaw * (createdRaw < 2e10 ? 1000 : 1)).toISOString()
    : null;

  return [
    buildAvitoDemandDraft({
      chatId,
      messageId,
      text,
      authorName,
      itemId,
      itemTitle,
      publishedAt,
      rawPayload: payload,
    }),
  ];
}
