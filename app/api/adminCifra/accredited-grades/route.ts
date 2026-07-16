// app/api/adminCifra/accredited-grades/route.ts
// Справочник аккредитованных марок (whitelist из выписки Росаккредитации).
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const docKind = searchParams.get('doc_kind'); // concrete / mortar (опционально)

  let query = supabase
    .from('accredited_grades')
    .select('*')
    .eq('is_active', true)
    .order('strength_class');

  if (docKind) query = query.eq('doc_kind', docKind);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data || []);
}
