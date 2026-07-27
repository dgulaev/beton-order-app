import { getIntegrationSettings } from '@/lib/integrations/settings';
import type { DemandCollector, DemandDraft } from './types';

/**
 * Легальный коллектор: JSON-лента по URL (агрегатор тендеров / свой экспорт).
 * URL: integration_settings / DEMAND_FEED_URL
 */
export const feedCollector: DemandCollector = {
  source: 'feed',

  async collect() {
    const { demand } = await getIntegrationSettings();
    const url = demand.feedUrl?.trim();
    if (!url) return [];

    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) {
      throw new Error(`DEMAND_FEED_URL ${res.status}`);
    }

    const json = await res.json();
    const items = Array.isArray(json) ? json : json.items || json.data || [];

    return (items as Record<string, unknown>[]).map((item, idx): DemandDraft => {
      const title = String(item.title || item.name || 'Запрос на бетон');
      const body = item.body != null ? String(item.body) : item.description != null ? String(item.description) : null;
      const externalId = item.id != null ? String(item.id) : item.external_id != null ? String(item.external_id) : `${title.slice(0, 40)}:${idx}`;
      return {
        source: 'feed',
        external_id: externalId,
        external_url: item.url != null ? String(item.url) : item.external_url != null ? String(item.external_url) : null,
        title,
        body,
        region: item.region != null ? String(item.region) : null,
        published_at: item.published_at != null ? String(item.published_at) : null,
        buyer_type: item.buyer_type != null ? String(item.buyer_type) : null,
        raw_payload: item,
      };
    });
  },
};
