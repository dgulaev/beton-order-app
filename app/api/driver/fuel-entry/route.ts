import { NextRequest, NextResponse } from 'next/server';
import { requireDriver } from '@/lib/driverAuth';
import { ensureFleetDocumentsBucket } from '@/lib/fleetDocumentsServer';
import {
  FLEET_DOCUMENTS_BUCKET,
  isAllowedFleetDocument,
  resolveFleetDocumentMime,
} from '@/lib/fleetLifecycle';
import { safeStorageFileName } from '@/lib/safeStorageFileName';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

/**
 * POST — заправка от водителя.
 * JSON или FormData: liters, amount_rub?, odometer_km?, receipt?
 */
export async function POST(request: NextRequest) {
  try {
    const driver = await requireDriver(request);
    if (!driver) {
      return NextResponse.json({ success: false, message: 'Доступ запрещён' }, { status: 403 });
    }

    const contentType = request.headers.get('content-type') || '';
    let liters = 0;
    let amountRub: number | null = null;
    let odometerKm: number | null = null;
    let receiptPath: string | null = null;

    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData();
      liters = Number(form.get('liters'));
      amountRub =
        form.get('amount_rub') != null && String(form.get('amount_rub')) !== ''
          ? Number(form.get('amount_rub'))
          : null;
      odometerKm =
        form.get('odometer_km') != null && String(form.get('odometer_km')) !== ''
          ? Number(form.get('odometer_km'))
          : null;
      const file = form.get('receipt') ?? form.get('photo');
      if (file instanceof File && file.size > 0) {
        const bad = isAllowedFleetDocument(file);
        if (bad) {
          return NextResponse.json({ success: false, message: bad }, { status: 400 });
        }
        await ensureFleetDocumentsBucket();
        const mime = resolveFleetDocumentMime(file);
        const path = `fuel/${driver.id}/${Date.now()}_${safeStorageFileName(file.name || 'receipt.jpg')}`;
        const buf = Buffer.from(await file.arrayBuffer());
        const { error: upErr } = await supabaseAdmin.storage
          .from(FLEET_DOCUMENTS_BUCKET)
          .upload(path, buf, { contentType: mime || 'image/jpeg', upsert: false });
        if (upErr) {
          return NextResponse.json(
            { success: false, message: upErr.message || 'Не удалось загрузить чек' },
            { status: 500 },
          );
        }
        receiptPath = path;
      }
    } else {
      const body = await request.json().catch(() => ({}));
      liters = Number(body.liters);
      amountRub =
        body.amount_rub != null && body.amount_rub !== '' ? Number(body.amount_rub) : null;
      odometerKm =
        body.odometer_km != null && body.odometer_km !== '' ? Number(body.odometer_km) : null;
    }

    if (!(liters > 0) || !Number.isFinite(liters)) {
      return NextResponse.json(
        { success: false, message: 'Укажите литры (> 0)' },
        { status: 400 },
      );
    }

    const { data, error } = await supabaseAdmin
      .from('fuel_entries')
      .insert({
        mixer_id: driver.id,
        liters,
        amount_rub: amountRub != null && Number.isFinite(amountRub) ? amountRub : null,
        odometer_km: odometerKm != null && Number.isFinite(odometerKm) ? odometerKm : null,
        filled_at: new Date().toISOString(),
        receipt_path: receiptPath,
        created_by: driver.driver || driver.number,
      })
      .select('id')
      .single();

    if (error) {
      const hint = /fuel_entries|schema cache|does not exist/i.test(error.message)
        ? ' — выполните scripts/fleet-fuel-expenses.sql'
        : '';
      return NextResponse.json(
        { success: false, message: (error.message || 'Ошибка записи') + hint },
        { status: 500 },
      );
    }

    if (odometerKm != null && Number.isFinite(odometerKm)) {
      const { data: mixer } = await supabaseAdmin
        .from('mixers')
        .select('odometer_km')
        .eq('id', driver.id)
        .maybeSingle();
      const cur = mixer?.odometer_km != null ? Number(mixer.odometer_km) : null;
      if (cur == null || odometerKm >= cur) {
        await supabaseAdmin
          .from('mixers')
          .update({ odometer_km: odometerKm })
          .eq('id', driver.id);
      }
    }

    return NextResponse.json({
      success: true,
      entryId: data?.id,
      message: 'Заправка сохранена',
    });
  } catch (e) {
    console.error('Driver fuel-entry error:', e);
    return NextResponse.json(
      { success: false, message: e instanceof Error ? e.message : 'Ошибка сервера' },
      { status: 500 },
    );
  }
}
