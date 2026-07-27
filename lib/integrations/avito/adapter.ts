import type { MarketplaceAdapter } from '@/lib/integrations/marketplaceAdapter';
import { isAvitoConfigured } from './auth';
import { fetchAvitoChats, fetchAvitoItems } from './client';
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
    return items.map(avitoItemToListing);
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
  const chats = await fetchAvitoChats(true);
  const leads = chats.map(avitoChatToLead).filter(Boolean);
  return leads as NonNullable<ReturnType<typeof avitoChatToLead>>[];
}
