// app/api/adminCifra/concrete-passports/route.ts
// Паспорта качества бетона/раствора: сохранение, чтение и сборка черновика
// (автозаполнение из заказа + рецептуры + испытаний + реквизитов лаборатории).
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { findRecipeByGrade } from '@/lib/recipeAdditives';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Сборка черновика паспорта по заказу — данные тянутся из orders, recipes,
// concrete_tests, lab_settings и справочника accredited_grades.
async function buildAutofill(orderId: number, docKind: string) {
  const [{ data: order }, { data: settings }, { data: allRecipes }] = await Promise.all([
    supabase.from('orders').select('*').eq('id', orderId).maybeSingle(),
    supabase.from('lab_settings').select('*').eq('id', 1).maybeSingle(),
    supabase.from('recipes').select('*'),
  ]);

  const grade = order?.grade || '';

  // Рецептура по марке — та же гибкая логика, что в заявках/отчётах.
  const recipe = grade ? findRecipeByGrade(allRecipes || [], grade) : null;

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
    // Добавка по умолчанию: бетон — ПФМ-НЛК, раствор — ЛинамиксР (редактируется).
    additive: docKind === 'mortar' ? 'ЛинамиксР' : 'ПФМ-НЛК',
    // Крупность заполнителя в растворах не нормируется — не заполняем.
    max_aggregate: docKind === 'mortar' ? '' : '20мм',
    keeping_min: 'не менее 120мин',
    // Прочность из испытаний
    required_strength_28: test28?.required_strength ?? '',
    actual_strength_28: test28?.actual_strength_mpa ?? '',
    actual_strength_7: test7?.actual_strength_mpa ?? '',
    // Номер номинального состава берём из рецептуры (редактируется в паспорте).
    mix_no: recipe?.mix_no ?? '',
    // По умолчанию номер партии = номер заявки (привязка для лаборанта/печати).
    batch_no: String(orderId),
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
  // Разрешаем только известные колонки — лишние поля из клиента не ломают insert.
  const row = {
    passport_no: body.passport_no ?? null,
    doc_kind: body.doc_kind === 'mortar' ? 'mortar' : 'concrete',
    order_id: body.order_id != null && body.order_id !== '' ? Number(body.order_id) : null,
    spec_id: body.spec_id != null && body.spec_id !== '' ? Number(body.spec_id) : null,
    payload: body.payload ?? null,
    created_by: body.created_by != null && body.created_by !== '' ? Number(body.created_by) : null,
    created_by_name: body.created_by_name ?? null,
  };
  const { data, error } = await supabase.from('concrete_passports').insert([row]).select().single();
  if (error) {
    const msg = error.message || 'insert failed';
    // Старый unique на order_id блокирует второй паспорт на заявку.
    if (msg.includes('uniq_concrete_passports_order')) {
      return NextResponse.json(
        {
          error:
            'В базе стоит ограничение «один паспорт на заявку». Выполни scripts/drop-uniq-concrete-passports-order.sql в Supabase SQL Editor.',
        },
        { status: 500 }
      );
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
  return NextResponse.json(data);
}

export async function PUT(request: NextRequest) {
  const body = await request.json();
  const id = body.id;
  if (id == null) return NextResponse.json({ error: 'ID required' }, { status: 400 });

  // Как в POST — только известные колонки. order_id не затираем null'ом,
  // если клиент его не прислал (иначе пропадает привязка к заявке).
  const updateData: Record<string, unknown> = {};
  if ('passport_no' in body) updateData.passport_no = body.passport_no ?? null;
  if ('doc_kind' in body) updateData.doc_kind = body.doc_kind === 'mortar' ? 'mortar' : 'concrete';
  if ('payload' in body) updateData.payload = body.payload ?? null;
  if ('spec_id' in body) {
    updateData.spec_id = body.spec_id != null && body.spec_id !== '' ? Number(body.spec_id) : null;
  }
  if (body.order_id != null && body.order_id !== '') {
    updateData.order_id = Number(body.order_id);
  }

  const { data, error } = await supabase
    .from('concrete_passports')
    .update(updateData)
    .eq('id', id)
    .select()
    .single();
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
