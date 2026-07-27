import { registerMarketplaceAdapter } from '@/lib/integrations/marketplaceAdapter';
import { avitoAdapter } from './adapter';

let registered = false;

export function ensureAvitoAdapterRegistered(): void {
  if (registered) return;
  registerMarketplaceAdapter(avitoAdapter);
  registered = true;
}

export { avitoAdapter } from './adapter';
export { isAvitoConfigured, getAvitoAccessToken, getAvitoUserId } from './auth';
export {
  fetchAvitoItems,
  fetchAvitoItemInfo,
  fetchAvitoItemsStats,
  fetchAvitoChats,
  fetchAvitoChatMessages,
  sendAvitoMessage,
  markAvitoChatRead,
  updateAvitoItemPrice,
  subscribeAvitoWebhook,
  listAvitoWebhookSubscriptions,
  explainAvitoMessengerError,
} from './client';
export { pollAvitoIncomingLeads } from './adapter';
export {
  normalizeAvitoWebhookPayload,
  avitoItemToListing,
  avitoChatToLead,
} from './normalize';
