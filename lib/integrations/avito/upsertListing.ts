import { supabaseAdmin } from '@/lib/supabaseAdmin';
import type { MarketplaceListingDraft } from '@/lib/integrations/marketplaceAdapter';

/**
 * Идемпотентный upsert объявления: не затирает локальные title/description/template,
 * не обнуляет views/contacts, если Stats API не вернул цифры.
 */
export async function upsertMarketplaceListing(
  L: MarketplaceListingDraft,
): Promise<{ ok: boolean; error?: string }> {
  const { data: existing } = await supabaseAdmin
    .from('marketplace_listings')
    .select('title, description, template_key, views, contacts, raw_payload')
    .eq('source', L.source)
    .eq('external_id', L.external_id)
    .maybeSingle();

  const hasStats =
    L.raw_payload != null &&
    typeof L.raw_payload === 'object' &&
    '_stats' in L.raw_payload &&
    (L.raw_payload as { _stats?: unknown })._stats != null;

  const views = hasStats
    ? (L.views ?? 0)
    : (existing?.views ?? L.views ?? 0);
  const contacts = hasStats
    ? (L.contacts ?? 0)
    : (existing?.contacts ?? L.contacts ?? 0);

  let rawPayload = L.raw_payload ?? null;
  if (!hasStats && existing?.raw_payload && typeof existing.raw_payload === 'object') {
    const prev = existing.raw_payload as Record<string, unknown>;
    if (prev._stats != null) {
      rawPayload = { ...(L.raw_payload || {}), _stats: prev._stats };
    }
  }

  const { error } = await supabaseAdmin.from('marketplace_listings').upsert(
    {
      source: L.source,
      external_id: L.external_id,
      title: L.title ?? existing?.title ?? null,
      description: L.description ?? existing?.description ?? null,
      price: L.price,
      status: L.status || 'active',
      url: L.url,
      category: L.category,
      city: L.city ?? null,
      views,
      contacts,
      template_key: L.template_key ?? existing?.template_key ?? null,
      raw_payload: rawPayload,
      last_synced_at: new Date().toISOString(),
    },
    { onConflict: 'source,external_id' },
  );

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
