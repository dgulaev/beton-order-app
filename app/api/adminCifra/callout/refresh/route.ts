import { NextRequest, NextResponse } from 'next/server';
import { SALES_ROLES, requireAdminCifraStaff } from '@/lib/adminCifraAuth';
import { refreshTenderWinner } from '@/lib/callout/calloutService';

/** Подтянуть победителя по callout_tenders.id (в т.ч. без карточки prospect). */
export async function POST(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request, SALES_ROLES);
  if (auth.error) return auth.error;

  try {
    const body = await request.json();
    const tenderId = Number(body.tender_id);
    if (!Number.isFinite(tenderId)) {
      return NextResponse.json({ success: false, error: 'tender_id обязателен' }, { status: 400 });
    }
    const result = await refreshTenderWinner(tenderId);
    return NextResponse.json({ success: result.ok, ...result });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'Ошибка' },
      { status: 500 },
    );
  }
}
