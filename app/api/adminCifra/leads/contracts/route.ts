import { NextRequest, NextResponse } from 'next/server';
import { SALES_ROLES, requireAdminCifraStaff } from '@/lib/adminCifraAuth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

/** GET ?leadIds=1,2,3 — метаданные контрактов для списка лидов (без signed url). */
export async function GET(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request, SALES_ROLES);
  if (auth.error) return auth.error;

  const raw = request.nextUrl.searchParams.get('leadIds') || '';
  const ids = raw
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0)
    .slice(0, 200);

  if (ids.length === 0) {
    return NextResponse.json({ success: true, contracts: [] });
  }

  const { data, error } = await supabaseAdmin
    .from('lead_contracts')
    .select('id, lead_id, file_name, mime_type, size_bytes, uploaded_by_name, created_at')
    .in('lead_id', ids)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[leads/contracts GET]', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, contracts: data ?? [] });
}
