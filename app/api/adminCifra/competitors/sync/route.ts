import { NextRequest, NextResponse } from 'next/server';
import { requireAdminCifraStaff } from '@/lib/adminCifraAuth';
import { syncCompetitorsCatalog } from '@/lib/competitors/syncCatalog';

/** POST — обновить карточки, точки погрузки и спарсить прайсы. */
export async function POST(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request, ['admin']);
  if (auth.error) return auth.error;

  try {
    const body = await request.json().catch(() => ({}));
    const parsePrices = body?.parsePrices !== false;
    const result = await syncCompetitorsCatalog({ parsePrices });
    return NextResponse.json({ success: true, ...result });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
