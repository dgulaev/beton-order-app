// app/api/adminCifra/lab-settings/route.ts
// Реквизиты организации/лаборатории для паспорта качества (одна строка, id=1).
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  const { data, error } = await supabase.from('lab_settings').select('*').eq('id', 1).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data || {});
}

const ALLOWED_FIELDS = [
  'org_name',
  'org_address',
  'inn',
  'kpp',
  'phone',
  'director_name',
  'lab_head_name',
  'lab_attestat',
  'aeff_class',
  'declaration_concrete',
  'declaration_mortar',
  'gost_concrete',
  'gost_mortar',
  'fsa_url_concrete',
  'fsa_url_mortar',
  'pfm_density_kg_per_l',
  'linomix_density_kg_per_l',
] as const;

export async function PUT(request: NextRequest) {
  const body = await request.json();
  const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const key of ALLOWED_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      updateData[key] = body[key];
    }
  }
  const { data, error } = await supabase
    .from('lab_settings')
    .update(updateData)
    .eq('id', 1)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
