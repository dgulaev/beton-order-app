import { NextRequest, NextResponse } from 'next/server';
import { isAvitoConfigured, pollAvitoIncomingLeads } from '@/lib/integrations/avito';
import { upsertMarketplaceListing } from '@/lib/integrations/avito/upsertListing';
import { registerAllMarketplaceAdapters } from '@/lib/integrations/registerAll';
import { getMarketplaceAdapter } from '@/lib/integrations/marketplaceAdapter';
import { getIntegrationSettings } from '@/lib/integrations/settings';
import { upsertLead } from '@/lib/leadService';
import { requireCronAuth } from '@/lib/cronAuth';

/**
 * Fallback: если webhook Авито протух — подтягиваем непрочитанные чаты
 * и синхронизируем объявления.
 */
export async function GET(req: NextRequest) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  await getIntegrationSettings(true);
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
        const r = await upsertMarketplaceListing(L);
        if (r.ok) listingsUpserted += 1;
        else if (r.error) errors.push(`listing ${L.external_id}: ${r.error}`);
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
