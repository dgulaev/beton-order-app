import { NextRequest, NextResponse } from 'next/server';
import { isAvitoConfigured, pollAvitoIncomingLeads } from '@/lib/integrations/avito';
import { registerAllMarketplaceAdapters } from '@/lib/integrations/registerAll';
import { getMarketplaceAdapter } from '@/lib/integrations/marketplaceAdapter';
import { upsertLead } from '@/lib/leadService';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { requireCronAuth } from '@/lib/cronAuth';

/**
 * Fallback: если webhook Авито протух — подтягиваем непрочитанные чаты
 * и синхронизируем объявления.
 */
export async function GET(req: NextRequest) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  if (!isAvitoConfigured()) {
    return NextResponse.json({ success: true, skipped: true, reason: 'Avito not configured' });
  }

  registerAllMarketplaceAdapters();
  const adapter = getMarketplaceAdapter('avito');

  let leadsCreated = 0;
  let listingsUpserted = 0;
  const errors: string[] = [];

  try {
    const drafts = await pollAvitoIncomingLeads();
    for (const d of drafts) {
      const r = await upsertLead(d);
      if (r?.created) leadsCreated += 1;
    }
  } catch (e: unknown) {
    errors.push(`leads: ${e instanceof Error ? e.message : String(e)}`);
  }

  try {
    if (adapter?.fetchListings) {
      const listings = await adapter.fetchListings();
      for (const L of listings) {
        const { error } = await supabaseAdmin.from('marketplace_listings').upsert(
          {
            source: L.source,
            external_id: L.external_id,
            title: L.title,
            description: L.description,
            price: L.price,
            status: L.status || 'active',
            url: L.url,
            category: L.category,
            city: L.city,
            views: L.views ?? 0,
            contacts: L.contacts ?? 0,
            template_key: L.template_key,
            raw_payload: L.raw_payload,
            last_synced_at: new Date().toISOString(),
          },
          { onConflict: 'source,external_id' },
        );
        if (error) errors.push(`listing ${L.external_id}: ${error.message}`);
        else listingsUpserted += 1;
      }
    }
  } catch (e: unknown) {
    errors.push(`listings: ${e instanceof Error ? e.message : String(e)}`);
  }

  return NextResponse.json({
    success: errors.length === 0,
    leadsCreated,
    listingsUpserted,
    errors,
  });
}
