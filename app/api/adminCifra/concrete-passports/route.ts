// app/api/adminCifra/concrete-passports/route.ts
// Паспорта качества бетона/раствора: сохранение, чтение и сборка черновика
// (автозаполнение из заказа + рецептуры + испытаний + реквизитов лаборатории).
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Сборка черновика паспорта по заказу — данные тянутся из orders, recipes,
// concrete_tests, lab_settings и справочника accredited_grades.
async function buildAutofill(orderId: number, docKind: string) {
  const [{ data: order }, { data: settings }] = await Promise.all([
    supabase.from('orders').select('*').eq('id', orderId).maybeSingle(),
    supabase.from('lab_settings').select('*').eq('id', 1).maybeSingle(),
  ]);

  const grade = order?.grade || '';

  // Рецептура по коду марки (та же логика связки, что и в заказах).
  let recipe: any = null;
  if (grade) {
    const { data: recipes } = await supabase.from('recipes').select('*').eq('code', grade).limit(1);
    recipe = recipes?.[0] || null;
  }

  // Аккредитованная марка по совпадению marka (напр. "М400").
  let accredited: any = null;
  if (grade) {
    const { data: acc } = await supabase
      .from('accredited_grades')
      .select('*')
      .eq('doc_kind', docKind)
      .eq('marka', grade)
      .limit(1);
    accredited = acc?.[0] || null;
  }

  // Испытания по заказу (для прочности 7/28 сут).
  let tests: any[] = [];
  if (orderId) {
    const { data: t } = await supabase
      .from('concrete_tests')
      .select('*')
      .eq('order_id', orderId)
      .order('sample_date', { ascending: false });
    tests = t || [];
  }
  const test28 = tests.find((t) => String(t.test_type) === '28');
  const test7 = tests.find((t) => String(t.test_type) === '7');

  const consumer =
    order?.organization_name || order?.full_name || '';

  return {
    doc_kind: docKind,
    gost: docKind === 'mortar' ? settings?.gost_mortar : settings?.gost_concrete,
    declaration_no: docKind === 'mortar' ? settings?.declaration_mortar : settings?.declaration_concrete,
    fsa_url: docKind === 'mortar' ? settings?.fsa_url_mortar : settings?.fsa_url_concrete,
    // Реквизиты организации/лаборатории
    org_name: settings?.org_name || '',
    org_address: settings?.org_address || '',
    inn: settings?.inn || '',
    kpp: settings?.kpp || '',
    phone: settings?.phone || '',
    lab_head_name: settings?.lab_head_name || '',
    aeff_class: settings?.aeff_class || '',
    // Данные заказа
    order_id: orderId,
    consumer,
    consumer_address: order?.address || '',
    shipment_date: order?.delivery_date || '',
    volume: order?.volume ?? '',
    grade,
    // Характеристики из рецептуры / аккредитованной марки
    marking: accredited?.marking || '',
    strength_class: recipe?.strength_class || accredited?.strength_class || '',
    frost_resistance: recipe?.frost_resistance || accredited?.frost_resistance || '',
    water_resistance: recipe?.water_resistance || accredited?.water_resistance || '',
    slump: recipe?.slump || accredited?.slump || '',
    additive: '',
    max_aggregate: '20мм',
    keeping_min: 'не менее 120мин',
    // Прочность из испытаний
    required_strength_28: test28?.required_strength ?? '',
    actual_strength_28: test28?.actual_strength_mpa ?? '',
    actual_strength_7: test7?.actual_strength_mpa ?? '',
    mix_no: '',
    batch_no: '',
  };
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const autofillOrder = searchParams.get('autofill');
  const docKind = searchParams.get('doc_kind') || 'concrete';
  const orderId = searchParams.get('order_id');
  const specId = searchParams.get('spec_id');

  if (autofillOrder) {
    const payload = await buildAutofill(Number(autofillOrder), docKind);
    return NextResponse.json(payload);
  }

  let query = supabase.from('concrete_passports').select('*').order('created_at', { ascending: false });
  if (orderId) query = query.eq('order_id', Number(orderId));
  if (specId) query = query.eq('spec_id', Number(specId));

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data || []);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { data, error } = await supabase.from('concrete_passports').insert([body]).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function PUT(request: NextRequest) {
  const body = await request.json();
  const { id, ...updateData } = body;
  const { data, error } = await supabase.from('concrete_passports').update(updateData).eq('id', id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'ID required' }, { status: 400 });
  const { error } = await supabase.from('concrete_passports').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
