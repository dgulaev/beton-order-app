import type { MarketplaceAdapter } from '@/lib/integrations/marketplaceAdapter';
import { isAvitoConfigured } from './auth';
import {
  fetchAvitoChats,
  fetchAvitoItemInfo,
  fetchAvitoItems,
  fetchAvitoItemsStats,
} from './client';
import {
  avitoChatToLead,
  avitoItemToListing,
  normalizeAvitoWebhookPayload,
} from './normalize';

export const avitoAdapter: MarketplaceAdapter = {
  source: 'avito',

  isConfigured() {
    return isAvitoConfigured();
  },

  async fetchListings() {
    const items = await fetchAvitoItems();
    // getItemInfo — url/status/vas; текста объявления там нет.
    const active = items.filter((i) => i.status === 'active').slice(0, 5);
    const [details, statsMap] = await Promise.all([
      Promise.all(
        active.map(async (item) => {
          const info = await fetchAvitoItemInfo(item.id);
          return info ? { ...item, ...info, id: item.id, title: item.title ?? info.title } : item;
        }),
      ),
      fetchAvitoItemsStats(items.map((i) => i.id)),
    ]);
    const byId = new Map(details.map((d) => [d.id, d]));

    return items.map((item) => {
      const merged = byId.get(item.id) ?? item;
      const draft = avitoItemToListing(merged);
      const st = statsMap.get(String(item.id));
      if (st) {
        draft.views = st.views;
        draft.contacts = st.contacts;
        draft.raw_payload = {
          ...(draft.raw_payload || {}),
          _stats: st,
        };
      }
      return draft;
    });
  },

  normalizeLead(raw) {
    const leads = normalizeAvitoWebhookPayload(raw);
    return leads[0] ?? null;
  },

  async handleWebhook(body) {
    const leads = normalizeAvitoWebhookPayload(body);
    return { leads, skipped: leads.length === 0 ? 1 : 0 };
  },
};

/** Fallback: непрочитанные чаты → лиды (если webhook протух). */
export async function pollAvitoIncomingLeads() {
  const chats = await fetchAvitoChats({ unreadOnly: true });
  const leads = chats.map(avitoChatToLead).filter(Boolean);
  return leads as NonNullable<ReturnType<typeof avitoChatToLead>>[];
}
