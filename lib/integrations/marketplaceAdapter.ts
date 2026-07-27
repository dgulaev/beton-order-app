import type { LeadDraft } from '@/lib/leads';

export type MarketplaceListingDraft = {
  source: string;
  external_id: string;
  title?: string | null;
  description?: string | null;
  price?: number | null;
  status?: string | null;
  url?: string | null;
  category?: string | null;
  city?: string | null;
  views?: number | null;
  contacts?: number | null;
  template_key?: string | null;
  raw_payload?: Record<string, unknown> | null;
};

/**
 * Единый контракт площадки (Авито и следующие).
 * Каждая новая площадка = новый adapter без переписывания inbox.
 */
export interface MarketplaceAdapter {
  readonly source: string;
  isConfigured(): boolean;
  fetchListings?(): Promise<MarketplaceListingDraft[]>;
  publishOrUpdate?(payload: {
    externalId?: string;
    title: string;
    description: string;
    price: number;
  }): Promise<{ external_id: string; url?: string | null }>;
  normalizeLead?(raw: unknown): LeadDraft | null;
  handleWebhook?(body: unknown, headers: Headers): Promise<{
    leads: LeadDraft[];
    skipped?: number;
  }>;
}

const registry = new Map<string, MarketplaceAdapter>();

export function registerMarketplaceAdapter(adapter: MarketplaceAdapter): void {
  registry.set(adapter.source, adapter);
}

export function getMarketplaceAdapter(source: string): MarketplaceAdapter | undefined {
  return registry.get(source);
}

export function listMarketplaceAdapters(): MarketplaceAdapter[] {
  return Array.from(registry.values());
}
