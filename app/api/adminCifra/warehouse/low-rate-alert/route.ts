// Ack алерта «расход слишком низкий» по силосу (staff).
import { NextRequest, NextResponse } from 'next/server';
import { ADMIN_CIFRA_STAFF_ROLES, requireAdminCifraStaff } from '@/lib/adminCifraAuth';
import { supabaseAdmin as supabase } from '@/lib/supabaseAdmin';

export async function POST(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request, ADMIN_CIFRA_STAFF_ROLES);
  if (auth.error) return auth.error;

  try {
    const body = await request.json().catch(() => ({}));
    const siloIdsRaw: unknown[] = Array.isArray(body?.siloIds)
      ? body.siloIds
      : body?.siloId != null
        ? [body.siloId]
        : [];

    const siloIds: number[] = [];
    for (const x of siloIdsRaw) {
      const n = Number(x);
      if ([1, 2, 3].includes(n) && !siloIds.includes(n)) siloIds.push(n);
    }

    if (siloIds.length === 0) {
      return NextResponse.json({ error: 'Укажи siloId' }, { status: 400 });
    }

    const errors: string[] = [];
    for (const siloId of siloIds) {
      const { data, error } = await supabase.rpc('warehouse_silo_ack_low_rate_alert', {
        p_silo_id: siloId,
      });
      if (error) {
        errors.push(`Силос ${siloId}: ${error.message}`);
        continue;
      }
      const row = Array.isArray(data) ? data[0] : data;
      if (row && row.ok === false) {
        errors.push(`Силос ${siloId}: ${row.error_text || 'ошибка'}`);
      }
    }

    return NextResponse.json({
      success: errors.length === 0,
      acked: siloIds,
      errors,
    });
  } catch (err: any) {
    console.error('low-rate-alert POST:', err);
    return NextResponse.json({ error: err.message || 'Ошибка' }, { status: 500 });
  }
}
