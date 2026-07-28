import { getIntegrationSettings } from '@/lib/integrations/settings';
import { isAvitoConfigured } from '@/lib/integrations/avito/auth';
import { fetchAvitoChats } from '@/lib/integrations/avito/client';
import { avitoChatToDemand } from '@/lib/integrations/avito/normalize';
import { isLikelySpam } from '@/lib/leads';
import type { DemandCollector, DemandDraft } from './types';

/** Максимум чатов за один прогон радара — щадим лимиты Messenger API. */
const MAX_CHATS = 20;

/**
 * Легальный контур «спрос с Авито» (радар):
 * только официальный Messenger API по ВАШИМ объявлениям.
 * Webhook пишет в Спрос всегда; здесь — доп. фильтр по «бетонным» словам,
 * чтобы радар не зашумлял ленту.
 */
const DEMAND_HINT =
  /(бетон|раствор|бст|\bм\s*\d{2,3}\b|\d+[.,]?\d*\s*(м3|м³|куб)|доставк|миксер|фундамент|стяжк)/i;

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
      const text = chat.last_message?.content?.text?.trim() || '';
      if (!text || isLikelySpam(text) || !DEMAND_HINT.test(text)) continue;
      const draft = avitoChatToDemand(chat);
      if (draft) drafts.push(draft);
    }
    return drafts;
  },
};
