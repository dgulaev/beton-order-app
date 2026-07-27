import { getIntegrationSettings } from '@/lib/integrations/settings';
import { isAvitoConfigured } from '@/lib/integrations/avito/auth';
import { fetchAvitoChats, type AvitoChat } from '@/lib/integrations/avito/client';
import { isLikelySpam } from '@/lib/leads';
import { enrichDemandFields } from '../score';
import type { DemandCollector, DemandDraft } from './types';

/** Максимум чатов за один прогон радара — щадим лимиты Messenger API. */
const MAX_CHATS = 20;

/**
 * Легальный контур «спрос с Авито»:
 * только официальный Messenger API по ВАШИМ объявлениям (входящие сообщения).
 * Публичный поиск / парсинг чужих объявлений — запрещены условиями API и здесь не реализованы.
 */
const DEMAND_HINT =
  /(бетон|раствор|бст|\bм\s*\d{2,3}\b|\d+[.,]?\d*\s*(м3|м³|куб)|доставк|миксер|фундамент|стяжк)/i;

function chatToDemand(chat: AvitoChat): DemandDraft | null {
  const msg = chat.last_message;
  if (!msg || msg.direction === 'out') return null;

  const text = msg.content?.text?.trim() || '';
  if (!text || isLikelySpam(text)) return null;
  if (!DEMAND_HINT.test(text)) return null;

  const stableMsgId =
    msg.id || (msg.created != null ? String(msg.created) : '');
  if (!chat.id || !stableMsgId) return null;

  const item = chat.context?.type === 'item' ? chat.context.value : undefined;
  const buyer = chat.users?.[0]?.name;
  const enriched = enrichDemandFields(text, text);

  return {
    source: 'avito',
    external_id: `avito-chat:${chat.id}:${stableMsgId}`,
    external_url: item?.url || `https://www.avito.ru/profile/messenger/channel/${chat.id}`,
    title: item?.title
      ? `Авито · ${item.title}`
      : buyer
        ? `Авито · ${buyer}`
        : 'Запрос из чата Авито',
    body: [buyer ? `От: ${buyer}` : null, text, item?.title ? `Объявление: ${item.title}` : null]
      .filter(Boolean)
      .join('\n\n'),
    region: null,
    published_at: msg.created
      ? new Date(msg.created * (msg.created < 2e10 ? 1000 : 1)).toISOString()
      : new Date().toISOString(),
    volume_m3: enriched.volume_m3,
    grades: enriched.grades,
    delivery_needed: enriched.delivery_needed,
    buyer_type: 'b2c',
    raw_payload: {
      legal: 'messenger_only',
      chat_id: chat.id,
      message_id: stableMsgId,
      listing_id: item?.id ?? null,
    },
  };
}

export const avitoMessengerCollector: DemandCollector = {
  source: 'avito',

  async collect(): Promise<DemandDraft[]> {
    const settings = await getIntegrationSettings();
    if (!settings.avito.demandFromMessenger) return [];
    if (!settings.avito.enabled || !isAvitoConfigured()) return [];

    // Только непрочитанные — меньше нагрузка и меньше шум.
    const chats = await fetchAvitoChats({ unreadOnly: true, limit: MAX_CHATS });
    const drafts: DemandDraft[] = [];
    for (const chat of chats.slice(0, MAX_CHATS)) {
      const draft = chatToDemand(chat);
      if (draft) drafts.push(draft);
    }
    return drafts;
  },
};
