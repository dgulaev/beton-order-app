import { NextRequest, NextResponse } from 'next/server';
import { isAvitoConfigured, pollAvitoIncomingDemand } from '@/lib/integrations/avito';
import { upsertMarketplaceListing } from '@/lib/integrations/avito/upsertListing';
import { registerAllMarketplaceAdapters } from '@/lib/integrations/registerAll';
import { getMarketplaceAdapter } from '@/lib/integrations/marketplaceAdapter';
import { getIntegrationSettings } from '@/lib/integrations/settings';
import { upsertDemandDraft } from '@/lib/demand/demandService';
import { requireCronAuth } from '@/lib/cronAuth';

/**
 * Fallback: если webhook Авито протух — подтягиваем непрочитанные чаты в Спрос
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

  let demandsCreated = 0;
  let listingsUpserted = 0;
  const errors: string[] = [];

  try {
    const drafts = await pollAvitoIncomingDemand();
    for (const d of drafts) {
      const r = await upsertDemandDraft(d);
      if (r?.created) demandsCreated += 1;
    }
  } catch (e: unknown) {
    errors.push(`demands: ${e instanceof Error ? e.message : String(e)}`);
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
    demandsCreated,
    listingsUpserted,
    errors,
  });
}
