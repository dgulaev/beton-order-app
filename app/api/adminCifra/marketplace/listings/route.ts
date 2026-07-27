import { NextRequest, NextResponse } from 'next/server';
import { SALES_ROLES, requireAdminCifraStaff } from '@/lib/adminCifraAuth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { isAvitoConfigured } from '@/lib/integrations/avito';
import { upsertMarketplaceListing } from '@/lib/integrations/avito/upsertListing';
import { registerAllMarketplaceAdapters } from '@/lib/integrations/registerAll';
import { getMarketplaceAdapter } from '@/lib/integrations/marketplaceAdapter';
import { getIntegrationSettings } from '@/lib/integrations/settings';
import { listListingTemplates } from '@/lib/avitoListingTemplates';

export async function GET(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request, SALES_ROLES);
  if (auth.error) return auth.error;

  await getIntegrationSettings();
  const source = request.nextUrl.searchParams.get('source') || undefined;

  let query = supabaseAdmin
    .from('marketplace_listings')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(200);

  if (source) query = query.eq('source', source);

  const [{ data, error }, templatesResult] = await Promise.all([
    query,
    listListingTemplates(),
  ]);
  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    listings: data ?? [],
    templates: templatesResult.templates,
    templatesPersistable: templatesResult.persistable,
    templatesPersistError: templatesResult.persistError,
    avitoConfigured: isAvitoConfigured(),
  });
}

/** Синхронизация объявлений с площадки (source=avito по умолчанию). */
export async function POST(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request, SALES_ROLES);
  if (auth.error) return auth.error;

  try {
    const body = await request.json().catch(() => ({}));
    const source = body.source || 'avito';

    registerAllMarketplaceAdapters();
    await getIntegrationSettings(true);

    if (source === 'avito') {
      if (!isAvitoConfigured()) {
        return NextResponse.json(
          {
            success: false,
            error:
              'Авито не настроено. Заполни ключи на странице «Интеграции» или в env (AVITO_CLIENT_ID / SECRET / USER_ID).',
          },
          { status: 400 },
        );
      }
    }

    const adapter = getMarketplaceAdapter(source);
    if (!adapter?.fetchListings) {
      return NextResponse.json({ success: false, error: `Адаптер ${source} не найден` }, { status: 400 });
    }

    const listings = await adapter.fetchListings();
    let upserted = 0;
    const errors: string[] = [];
    for (const L of listings) {
      const r = await upsertMarketplaceListing(L);
      if (r.ok) upserted += 1;
      else if (r.error) errors.push(`${L.external_id}: ${r.error}`);
    }

    return NextResponse.json({
      success: errors.length === 0,
      upserted,
      total: listings.length,
      errors: errors.length ? errors.slice(0, 5) : undefined,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Ошибка';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
