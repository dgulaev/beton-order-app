// Паспорта / реализация ФБС.
// Храним в concrete_passports с doc_kind = 'fbs' (отдельная таблица не нужна).
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const DOC_KIND = 'fbs';

/**
 * Номер партии: YYYY-NNNN, счётчик с 0001 в каждом календарном году отдельно.
 * В 2026 → 2026-0001…; с 1 января 2027 нумерация начинается с 2027-0001.
 */
async function nextPassportNo(now = new Date()): Promise<string> {
  const year = now.getFullYear();
  const { data } = await supabase
    .from('concrete_passports')
    .select('passport_no')
    .eq('doc_kind', DOC_KIND)
    .ilike('passport_no', `${year}-%`);

  let max = 0;
  for (const row of data || []) {
    // Поддерживаем и старый вид «2026 - 000», и новый «2026-0001».
    const m = String(row.passport_no || '').match(/^(\d{4})\s*[-–]\s*(\d+)/);
    if (m && Number(m[1]) === year) max = Math.max(max, Number(m[2]));
  }
  return `${year}-${String(max + 1).padStart(4, '0')}`;
}

async function adjustFbsStock(fbsName: string, delta: number) {
  const name = String(fbsName || '').trim();
  if (!name || delta === 0) return { ok: true as const, oldCurrent: 0, newCurrent: 0, name };

  const { data: block, error } = await supabase
    .from('fbs_blocks')
    .select('id, current, name')
    .eq('name', name)
    .maybeSingle();

  if (error) return { ok: false as const, error: error.message };
  if (!block) return { ok: false as const, error: `Тип ФБС «${name}» не найден на складе` };

  const oldCurrent = Number(block.current || 0);
  const newCurrent = oldCurrent + delta;
  if (newCurrent < 0) {
    return {
      ok: false as const,
      error: `Недостаточно «${name}» на складе (есть ${oldCurrent} шт)`,
    };
  }

  const { error: updErr } = await supabase
    .from('fbs_blocks')
    .update({ current: newCurrent, updated_at: new Date().toISOString() })
    .eq('id', block.id);

  if (updErr) return { ok: false as const, error: updErr.message };
  return { ok: true as const, oldCurrent, newCurrent, name };
}

async function logWarehouseOp(opts: {
  operation_type: 'add' | 'subtract';
  item_type: string;
  amount: number;
  old_value: number;
  new_value: number;
  user_name?: string | null;
}) {
  const userName =
    typeof opts.user_name === 'string' && opts.user_name.trim()
      ? opts.user_name.trim().slice(0, 120)
      : null;
  const { error } = await supabase.from('warehouse_operations').insert({
    operation_type: opts.operation_type,
    item_type: opts.item_type,
    amount: Number(opts.amount || 0),
    old_value: Number(opts.old_value || 0),
    new_value: Number(opts.new_value || 0),
    unit: 'шт',
    user_name: userName,
  });
  if (error) console.error('История склада (ФБС):', error.message);
}

function actorFrom(body: any, searchParams?: URLSearchParams): string | null {
  const fromBody = typeof body?.user_name === 'string' ? body.user_name : '';
  const fromQuery = searchParams?.get('user_name') || '';
  const name = (fromBody || fromQuery).trim();
  return name || null;
}

function qtyFromPayload(payload: any): number {
  const n = parseInt(String(payload?.quantity ?? ''), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function nameFromPayload(payload: any): string {
  return String(payload?.fbs_mark || payload?.fbs_name || '').trim();
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const defaults = searchParams.get('defaults');

  if (defaults === '1') {
    const [{ data: settings }, passport_no] = await Promise.all([
      supabase.from('lab_settings').select('*').eq('id', 1).maybeSingle(),
      nextPassportNo(),
    ]);
    const s = settings || {};
    const now = new Date();
    const monthName = now.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
    return NextResponse.json({
      passport_no,
      product_name: 'Блоки фундаментные для стен подвалов',
      issue_date: now.toLocaleDateString('ru-RU'),
      manufacture_date: monthName,
      concrete_grade: 'М150 В12,5',
      release_strength_pct: '70 %',
      required_release_strength: '',
      actual_release_strength: '',
      frost_resistance: 'F 100',
      water_resistance: 'W 4',
      avg_density: '2,3 т/м³',
      embedded_steel: 'Диаметр 10А1 (А240)',
      rebar_steel: 'отсутствует',
      surface_category: 'А 7',
      gost: 'ГОСТ 13579-2018',
      org_name: s.org_name || '',
      org_address: s.org_address || '',
      inn: s.inn || '',
      kpp: s.kpp || '',
      phone: s.phone || '',
      lab_head_name: s.lab_head_name || '',
      aeff_class: s.aeff_class || 'I класс, не более 370 Бк/кг',
      declaration_no: s.declaration_concrete || '',
      decl_reg_date: '18.12.2023',
      fsa_url: s.fsa_url_concrete || '',
      consumer: '',
      quantity: '',
      fbs_mark: '',
    });
  }

  const { data, error } = await supabase
    .from('concrete_passports')
    .select('*')
    .eq('doc_kind', DOC_KIND)
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data || []);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const payload = body.payload || {};
    const fbsName = nameFromPayload(payload);
    const qty = qtyFromPayload(payload);

    if (!fbsName) {
      return NextResponse.json({ error: 'Укажите марку ФБС' }, { status: 400 });
    }
    if (!qty) {
      return NextResponse.json({ error: 'Укажите количество блоков' }, { status: 400 });
    }
    if (!String(payload.consumer || '').trim()) {
      return NextResponse.json({ error: 'Укажите организацию (кому выдан)' }, { status: 400 });
    }

    const stock = await adjustFbsStock(fbsName, -qty);
    if (!stock.ok) {
      return NextResponse.json({ error: stock.error }, { status: 400 });
    }

    const passport_no = body.passport_no || payload.passport_no || (await nextPassportNo());
    const actor = actorFrom(body);
    const row = {
      passport_no,
      doc_kind: DOC_KIND,
      order_id: null,
      spec_id: null,
      payload: {
        ...payload,
        passport_no,
        fbs_mark: fbsName,
        quantity: qty,
        stock_deducted: qty,
      },
      created_by: body.created_by != null && body.created_by !== '' ? Number(body.created_by) : null,
      created_by_name: body.created_by_name ?? actor,
    };

    const { data, error } = await supabase.from('concrete_passports').insert([row]).select().single();
    if (error) {
      // Откат списания
      await adjustFbsStock(fbsName, qty);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (stock.ok && 'oldCurrent' in stock) {
      await logWarehouseOp({
        operation_type: 'subtract',
        item_type: `${fbsName} · паспорт ${passport_no}`,
        amount: qty,
        old_value: stock.oldCurrent ?? 0,
        new_value: stock.newCurrent ?? 0,
        user_name: actor,
      });
    }

    return NextResponse.json({ ...data, stock });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Ошибка сохранения' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const id = body.id;
    if (id == null) return NextResponse.json({ error: 'ID required' }, { status: 400 });

    const { data: existing, error: loadErr } = await supabase
      .from('concrete_passports')
      .select('*')
      .eq('id', id)
      .eq('doc_kind', DOC_KIND)
      .maybeSingle();

    if (loadErr) return NextResponse.json({ error: loadErr.message }, { status: 500 });
    if (!existing) return NextResponse.json({ error: 'Паспорт не найден' }, { status: 404 });

    const oldPayload = existing.payload || {};
    const newPayload = body.payload || oldPayload;
    const oldName = nameFromPayload(oldPayload);
    const newName = nameFromPayload(newPayload);
    const oldQty = Number(oldPayload.stock_deducted ?? qtyFromPayload(oldPayload)) || 0;
    const newQty = qtyFromPayload(newPayload);

    if (!newName) {
      return NextResponse.json({ error: 'Укажите марку ФБС' }, { status: 400 });
    }
    if (!newQty) {
      return NextResponse.json({ error: 'Укажите количество блоков' }, { status: 400 });
    }

    const actor = actorFrom(body);
    const passport_no = body.passport_no ?? existing.passport_no;

    // Вернуть старое списание, списать новое — с записью в историю.
    let restore: Awaited<ReturnType<typeof adjustFbsStock>> | null = null;
    if (oldName && oldQty) {
      restore = await adjustFbsStock(oldName, oldQty);
      if (!restore.ok) {
        return NextResponse.json({ error: restore.error }, { status: 400 });
      }
    }
    const deduct = await adjustFbsStock(newName, -newQty);
    if (!deduct.ok) {
      if (oldName && oldQty) await adjustFbsStock(oldName, -oldQty);
      return NextResponse.json({ error: deduct.error }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('concrete_passports')
      .update({
        passport_no,
        payload: {
          ...newPayload,
          passport_no,
          fbs_mark: newName,
          quantity: newQty,
          stock_deducted: newQty,
        },
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      await adjustFbsStock(newName, newQty);
      if (oldName && oldQty) await adjustFbsStock(oldName, -oldQty);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const sameLine = oldName === newName;
    if (sameLine && oldQty === newQty) {
      // Только реквизиты паспорта — остаток не менялся, в историю склада не пишем.
    } else if (sameLine && deduct.ok && 'newCurrent' in deduct) {
      const delta = newQty - oldQty;
      const finalStock = Number(deduct.newCurrent ?? 0);
      const startStock = finalStock - oldQty + newQty;
      await logWarehouseOp({
        operation_type: delta > 0 ? 'subtract' : 'add',
        item_type: `${newName} · правка паспорта ${passport_no}`,
        amount: Math.abs(delta),
        old_value: startStock,
        new_value: finalStock,
        user_name: actor,
      });
    } else {
      if (restore && restore.ok && 'oldCurrent' in restore) {
        await logWarehouseOp({
          operation_type: 'add',
          item_type: `${oldName} · правка паспорта ${passport_no}`,
          amount: oldQty,
          old_value: restore.oldCurrent ?? 0,
          new_value: restore.newCurrent ?? 0,
          user_name: actor,
        });
      }
      if (deduct.ok && 'oldCurrent' in deduct) {
        await logWarehouseOp({
          operation_type: 'subtract',
          item_type: `${newName} · правка паспорта ${passport_no}`,
          amount: newQty,
          old_value: deduct.oldCurrent ?? 0,
          new_value: deduct.newCurrent ?? 0,
          user_name: actor,
        });
      }
    }

    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Ошибка обновления' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'ID required' }, { status: 400 });

  const { data: existing, error: loadErr } = await supabase
    .from('concrete_passports')
    .select('*')
    .eq('id', id)
    .eq('doc_kind', DOC_KIND)
    .maybeSingle();

  if (loadErr) return NextResponse.json({ error: loadErr.message }, { status: 500 });
  if (!existing) return NextResponse.json({ error: 'Паспорт не найден' }, { status: 404 });

  const payload = existing.payload || {};
  const name = nameFromPayload(payload);
  const qty = Number(payload.stock_deducted ?? qtyFromPayload(payload)) || 0;
  const passport_no = existing.passport_no || payload.passport_no || id;
  const actor = actorFrom(null, searchParams);

  const { error } = await supabase.from('concrete_passports').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (name && qty) {
    const stock = await adjustFbsStock(name, qty);
    if (stock.ok && 'oldCurrent' in stock) {
      await logWarehouseOp({
        operation_type: 'add',
        item_type: `${name} · отмена паспорта ${passport_no}`,
        amount: qty,
        old_value: stock.oldCurrent ?? 0,
        new_value: stock.newCurrent ?? 0,
        user_name: actor,
      });
    }
  }

  return NextResponse.json({ success: true });
}
