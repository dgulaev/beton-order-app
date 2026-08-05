import { NextRequest, NextResponse } from 'next/server';
import { FLEET_MUTATION_ROLES, requireAdminCifraStaff } from '@/lib/adminCifraAuth';
import {
  createFleetDocumentSignedUrl,
  ensureFleetDocumentsBucket,
  fleetTableMissingMessage,
} from '@/lib/fleetDocumentsServer';
import { normalizeFuelEntry } from '@/lib/fleetCosts';
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
    .from('fuel_entries')
    .select('*')
    .eq('mixer_id', mixerId)
    .order('filled_at', { ascending: false });

  // Границы суток Europe/Moscow (завод)
  if (from) query = query.gte('filled_at', `${from}T00:00:00+03:00`);
  if (to) query = query.lte('filled_at', `${to}T23:59:59.999+03:00`);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json(
      { success: false, error: fleetTableMissingMessage(error.message, 'fuel_entries') },
      { status: 500 },
    );
  }

  const entries = await Promise.all(
    (data ?? []).map((row) =>
      withReceiptUrl(normalizeFuelEntry(row as Record<string, unknown>)),
    ),
  );
  return NextResponse.json({ success: true, entries });
}

/** POST JSON или FormData (с чеком) */
export async function POST(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request, FLEET_MUTATION_ROLES);
  if (auth.error) return auth.error;

  try {
    const contentType = request.headers.get('content-type') || '';
    let mixerId = 0;
    let liters = 0;
    let amountRub: number | null = null;
    let odometerKm: number | null = null;
    let fuelType: string | null = null;
    let filledAt: string | null = null;
    let receiptPath: string | null = null;

    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData();
      mixerId = Number(form.get('mixer_id'));
      liters = Number(form.get('liters'));
      amountRub =
        form.get('amount_rub') != null && String(form.get('amount_rub')) !== ''
          ? Number(form.get('amount_rub'))
          : null;
      odometerKm =
        form.get('odometer_km') != null && String(form.get('odometer_km')) !== ''
          ? Number(form.get('odometer_km'))
          : null;
      fuelType = form.get('fuel_type') ? String(form.get('fuel_type')) : null;
      filledAt = form.get('filled_at') ? String(form.get('filled_at')) : null;
      const file = form.get('receipt');
      if (file instanceof File && file.size > 0) {
        const bad = isAllowedFleetDocument(file);
        if (bad) {
          return NextResponse.json({ success: false, error: bad }, { status: 400 });
        }
        await ensureFleetDocumentsBucket();
        const mime = resolveFleetDocumentMime(file);
        const path = `fuel/${mixerId}/${Date.now()}_${safeStorageFileName(file.name || 'receipt.jpg')}`;
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
      liters = Number(body.liters);
      amountRub =
        body.amount_rub != null && body.amount_rub !== '' ? Number(body.amount_rub) : null;
      odometerKm =
        body.odometer_km != null && body.odometer_km !== '' ? Number(body.odometer_km) : null;
      fuelType = body.fuel_type ? String(body.fuel_type) : null;
      filledAt = body.filled_at ? String(body.filled_at) : null;
    }

    if (!Number.isFinite(mixerId) || mixerId <= 0) {
      return NextResponse.json({ success: false, error: 'mixer_id обязателен' }, { status: 400 });
    }
    if (!(liters > 0)) {
      return NextResponse.json({ success: false, error: 'Укажите литры (> 0)' }, { status: 400 });
    }

    const row = {
      mixer_id: mixerId,
      liters,
      amount_rub: amountRub != null && Number.isFinite(amountRub) ? amountRub : null,
      odometer_km: odometerKm != null && Number.isFinite(odometerKm) ? odometerKm : null,
      fuel_type: fuelType,
      filled_at: filledAt || new Date().toISOString(),
      receipt_path: receiptPath,
      created_by: auth.user.full_name || 'Сотрудник',
    };

    const { data, error } = await supabaseAdmin
      .from('fuel_entries')
      .insert(row)
      .select('*')
      .single();

    if (error) {
      return NextResponse.json(
        { success: false, error: fleetTableMissingMessage(error.message, 'fuel_entries') },
        { status: 500 },
      );
    }

    // Обновить одометр на карточке, если заправка свежее
    if (row.odometer_km != null) {
      const { data: mixer } = await supabaseAdmin
        .from('mixers')
        .select('odometer_km')
        .eq('id', mixerId)
        .maybeSingle();
      const cur = mixer?.odometer_km != null ? Number(mixer.odometer_km) : null;
      if (cur == null || row.odometer_km >= cur) {
        await supabaseAdmin
          .from('mixers')
          .update({ odometer_km: row.odometer_km })
          .eq('id', mixerId);
      }
    }

    return NextResponse.json({
      success: true,
      entry: await withReceiptUrl(normalizeFuelEntry(data as Record<string, unknown>)),
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
    .from('fuel_entries')
    .select('receipt_path')
    .eq('id', id)
    .maybeSingle();

  const { error } = await supabaseAdmin.from('fuel_entries').delete().eq('id', id);
  if (error) {
    return NextResponse.json(
      { success: false, error: fleetTableMissingMessage(error.message, 'fuel_entries') },
      { status: 500 },
    );
  }

  if (existing?.receipt_path) {
    await supabaseAdmin.storage.from(FLEET_DOCUMENTS_BUCKET).remove([existing.receipt_path]);
  }

  return NextResponse.json({ success: true });
}
