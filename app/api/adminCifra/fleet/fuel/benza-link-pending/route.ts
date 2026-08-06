import { NextRequest, NextResponse } from 'next/server';
import { FLEET_MUTATION_ROLES, requireAdminCifraStaff } from '@/lib/adminCifraAuth';
import { linkBenzaPendingToMixers } from '@/lib/benzaFuelLink';

/** POST — привязать ожидающие заправки Benza к ТС в справочнике. */
export async function POST(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request, FLEET_MUTATION_ROLES);
  if (auth.error) return auth.error;

  try {
    const result = await linkBenzaPendingToMixers();
    return NextResponse.json({
      success: result.errors.length === 0 || result.linked > 0,
      linked: result.linked,
      errors: result.errors,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Ошибка привязки';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
