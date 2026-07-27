import { ensureAvitoAdapterRegistered } from '@/lib/integrations/avito';
import { registerMarketplaceAdapter, type MarketplaceAdapter } from '@/lib/integrations/marketplaceAdapter';

/**
 * Заглушка под следующую площадку (фаза 4).
 * Когда появятся credentials — заменить isConfigured/fetchListings/handleWebhook.
 */
const stubNextPlatformAdapter: MarketplaceAdapter = {
  source: 'stub',
  isConfigured: () => false,
  async fetchListings() {
    return [];
  },
  normalizeLead() {
    return null;
  },
};

let done = false;

export function registerAllMarketplaceAdapters(): void {
  if (done) return;
  ensureAvitoAdapterRegistered();
  registerMarketplaceAdapter(stubNextPlatformAdapter);
  done = true;
}
