import { NextRequest, NextResponse } from 'next/server';
import { FLEET_MUTATION_ROLES, requireAdminCifraStaff } from '@/lib/adminCifraAuth';
import {
  createFleetDocumentSignedUrl,
  ensureFleetDocumentsBucket,
  fleetTableMissingMessage,
} from '@/lib/fleetDocumentsServer';
import {
  EXPENSE_CATEGORIES,
  isExpenseCategory,
  normalizeExpense,
} from '@/lib/fleetCosts';
import { todayMoscowYmd } from '@/lib/fleetService';
import {
  FLEET_DOCUMENTS_BUCKET,
  isAllowedFleetDocument,
  resolveFleetDocumentMime,
} from '@/lib/fleetLifecycle';
import { safeStorageFileName } from '@/lib/safeStorageFileName';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

async function withReceiptUrl<T extends { receipt_path: string | null }>(
  row: T,
): Promise<T & { receipt_url?: string }> {
  if (!row.receipt_path) return row;
  try {
    const receipt_url = await createFleetDocumentSignedUrl(row.receipt_path, 3600);
    return { ...row, receipt_url };
  } catch {
    return row;
  }
}

/** GET ?mixer_id=&from=&to= */
export async function GET(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request);
  if (auth.error) return auth.error;

  const mixerId = Number(request.nextUrl.searchParams.get('mixer_id'));
  if (!Number.isFinite(mixerId) || mixerId <= 0) {
    return NextResponse.json({ success: false, error: 'mixer_id обязателен' }, { status: 400 });
  }

  const from = request.nextUrl.searchParams.get('from');
  const to = request.nextUrl.searchParams.get('to');

  let query = supabaseAdmin
    .from('fleet_expenses')
    .select('*')
    .eq('mixer_id', mixerId)
    .order('expense_date', { ascending: false });

  if (from) query = query.gte('expense_date', from);
  if (to) query = query.lte('expense_date', to);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json(
      { success: false, error: fleetTableMissingMessage(error.message, 'fleet_expenses') },
      { status: 500 },
    );
  }

  const expenses = await Promise.all(
    (data ?? []).map((row) =>
      withReceiptUrl(normalizeExpense(row as Record<string, unknown>)),
    ),
  );
  return NextResponse.json({
    success: true,
    expenses,
    categories: EXPENSE_CATEGORIES,
  });
}

/** POST JSON или FormData */
export async function POST(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request, FLEET_MUTATION_ROLES);
  if (auth.error) return auth.error;

  try {
    const contentType = request.headers.get('content-type') || '';
    let mixerId = 0;
    let category = 'other';
    let amountRub = 0;
    let description: string | null = null;
    let expenseDate: string = todayMoscowYmd();
    let receiptPath: string | null = null;

    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData();
      mixerId = Number(form.get('mixer_id'));
      category = String(form.get('category') || 'other');
      amountRub = Number(form.get('amount_rub'));
      description = form.get('description') ? String(form.get('description')).trim() : null;
      expenseDate = form.get('expense_date')
        ? String(form.get('expense_date')).slice(0, 10)
        : todayMoscowYmd();
      const file = form.get('receipt');
      if (file instanceof File && file.size > 0) {
        const bad = isAllowedFleetDocument(file);
        if (bad) {
          return NextResponse.json({ success: false, error: bad }, { status: 400 });
        }
        await ensureFleetDocumentsBucket();
        const mime = resolveFleetDocumentMime(file);
        const path = `expenses/${mixerId}/${Date.now()}_${safeStorageFileName(file.name || 'receipt.jpg')}`;
        const buf = Buffer.from(await file.arrayBuffer());
        const { error: upErr } = await supabaseAdmin.storage
          .from(FLEET_DOCUMENTS_BUCKET)
          .upload(path, buf, { contentType: mime || 'image/jpeg', upsert: false });
        if (upErr) {
          return NextResponse.json({ success: false, error: upErr.message }, { status: 500 });
        }
        receiptPath = path;
      }
    } else {
      const body = await request.json();
      mixerId = Number(body.mixer_id);
      category = String(body.category || 'other');
      amountRub = Number(body.amount_rub);
      description = body.description ? String(body.description).trim() : null;
      expenseDate = body.expense_date
        ? String(body.expense_date).slice(0, 10)
        : todayMoscowYmd();
    }

    if (!Number.isFinite(mixerId) || mixerId <= 0) {
      return NextResponse.json({ success: false, error: 'mixer_id обязателен' }, { status: 400 });
    }
    if (!isExpenseCategory(category)) {
      return NextResponse.json({ success: false, error: 'Некорректная категория' }, { status: 400 });
    }
    if (!(amountRub >= 0) || !Number.isFinite(amountRub)) {
      return NextResponse.json({ success: false, error: 'Укажите сумму' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('fleet_expenses')
      .insert({
        mixer_id: mixerId,
        category,
        amount_rub: amountRub,
        description,
        expense_date: expenseDate,
        receipt_path: receiptPath,
        created_by: auth.user.full_name || 'Сотрудник',
      })
      .select('*')
      .single();

    if (error) {
      return NextResponse.json(
        { success: false, error: fleetTableMissingMessage(error.message, 'fleet_expenses') },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      expense: await withReceiptUrl(normalizeExpense(data as Record<string, unknown>)),
    });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'Ошибка' },
      { status: 500 },
    );
  }
}

/** DELETE ?id= */
export async function DELETE(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request, FLEET_MUTATION_ROLES);
  if (auth.error) return auth.error;

  const id = Number(request.nextUrl.searchParams.get('id'));
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ success: false, error: 'id обязателен' }, { status: 400 });
  }

  const { data: existing } = await supabaseAdmin
    .from('fleet_expenses')
    .select('receipt_path')
    .eq('id', id)
    .maybeSingle();

  const { error } = await supabaseAdmin.from('fleet_expenses').delete().eq('id', id);
  if (error) {
    return NextResponse.json(
      { success: false, error: fleetTableMissingMessage(error.message, 'fleet_expenses') },
      { status: 500 },
    );
  }

  if (existing?.receipt_path) {
    await supabaseAdmin.storage.from(FLEET_DOCUMENTS_BUCKET).remove([existing.receipt_path]);
  }

  return NextResponse.json({ success: true });
}
