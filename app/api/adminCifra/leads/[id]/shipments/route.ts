import { NextRequest, NextResponse } from 'next/server';
import { SALES_ROLES, requireAdminCifraStaff } from '@/lib/adminCifraAuth';
import { getLeadShipmentsSummary } from '@/lib/leadShipments';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Ctx) {
  const auth = await requireAdminCifraStaff(request, SALES_ROLES);
  if (auth.error) return auth.error;

  const { id: idRaw } = await context.params;
  const id = Number(idRaw);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ success: false, error: 'Некорректный id' }, { status: 400 });
  }

  const summary = await getLeadShipmentsSummary(id);
  if (!summary) {
    return NextResponse.json({ success: false, error: 'Лид не найден' }, { status: 404 });
  }

  return NextResponse.json({ success: true, ...summary });
}
