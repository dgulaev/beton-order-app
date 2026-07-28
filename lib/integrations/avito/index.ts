import { registerMarketplaceAdapter } from '@/lib/integrations/marketplaceAdapter';
import { avitoAdapter } from './adapter';

let registered = false;

export function ensureAvitoAdapterRegistered(): void {
  if (registered) return;
  registerMarketplaceAdapter(avitoAdapter);
  registered = true;
}

export { avitoAdapter } from './adapter';
export {
  isAvitoConfigured,
  getAvitoAccessToken,
  getAvitoUserId,
  getAvitoWebhookSecret,
} from './auth';
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
export {
  isAvitoMessengerPaywallText,
  sanitizeAvitoMessageText,
} from './messageText';
export { pollAvitoIncomingLeads, pollAvitoIncomingDemand } from './adapter';
export {
  normalizeAvitoWebhookPayload,
  normalizeAvitoWebhookToDemand,
  avitoItemToListing,
  avitoChatToLead,
  avitoChatToDemand,
} from './normalize';
