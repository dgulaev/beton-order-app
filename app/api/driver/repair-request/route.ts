import { NextRequest, NextResponse } from 'next/server';
import { requireDriver } from '@/lib/driverAuth';
import { ensureFleetDocumentsBucket } from '@/lib/fleetDocumentsServer';
import { FLEET_DOCUMENTS_BUCKET, isAllowedFleetDocument, resolveFleetDocumentMime } from '@/lib/fleetLifecycle';
import { todayMoscowYmd } from '@/lib/fleetService';
import { safeStorageFileName } from '@/lib/safeStorageFileName';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

/**
 * POST — заявка на ремонт от водителя.
 * JSON: { description } или FormData: description + optional photo.
 * Ставит lifecycle_status = repair и создаёт fleet_service_records (requested).
 */
export async function POST(request: NextRequest) {
  try {
    const driver = await requireDriver(request);
    if (!driver) {
      return NextResponse.json({ success: false, message: 'Доступ запрещён' }, { status: 403 });
    }

    const contentType = request.headers.get('content-type') || '';
    let description = '';
    let photoPath: string | null = null;

    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData();
      description = String(form.get('description') || '').trim();
      const file = form.get('photo');
      if (file instanceof File && file.size > 0) {
        const bad = isAllowedFleetDocument(file);
        if (bad) {
          return NextResponse.json({ success: false, message: bad }, { status: 400 });
        }
        const mime = resolveFleetDocumentMime(file);
        await ensureFleetDocumentsBucket();
        const safeName = safeStorageFileName(file.name || 'photo.jpg');
        const path = `service/${driver.id}/${Date.now()}_${safeName}`;
        const buf = Buffer.from(await file.arrayBuffer());
        const { error: upErr } = await supabaseAdmin.storage
          .from(FLEET_DOCUMENTS_BUCKET)
          .upload(path, buf, { contentType: mime || 'image/jpeg', upsert: false });
        if (upErr) {
          return NextResponse.json(
            { success: false, message: upErr.message || 'Не удалось загрузить фото' },
            { status: 500 },
          );
        }
        photoPath = path;
      }
    } else {
      const body = await request.json().catch(() => ({}));
      description = String(body.description || '').trim();
    }

    if (description.length < 3) {
      return NextResponse.json(
        { success: false, message: 'Опишите неисправность (минимум 3 символа)' },
        { status: 400 },
      );
    }

    const today = todayMoscowYmd();
    const { data: record, error: recErr } = await supabaseAdmin
      .from('fleet_service_records')
      .insert({
        mixer_id: driver.id,
        status: 'requested',
        service_date: today,
        description: `[Водитель ${driver.driver || driver.number}] ${description}`,
        parts: [],
        labor_cost: 0,
        parts_cost: 0,
        photos: photoPath ? [photoPath] : [],
        created_by: driver.driver || driver.number,
      })
      .select('id')
      .single();

    if (recErr) {
      const hint = /fleet_service_records|schema cache|does not exist/i.test(recErr.message)
        ? ' — выполните scripts/fleet-service.sql'
        : '';
      return NextResponse.json(
        { success: false, message: (recErr.message || 'Ошибка записи') + hint },
        { status: 500 },
      );
    }

    await supabaseAdmin
      .from('mixers')
      .update({ lifecycle_status: 'repair' })
      .eq('id', driver.id);

    return NextResponse.json({
      success: true,
      recordId: record?.id,
      message: 'Заявка на ремонт отправлена. Машина отмечена «На ремонте».',
    });
  } catch (e) {
    console.error('Driver repair-request error:', e);
    return NextResponse.json(
      { success: false, message: e instanceof Error ? e.message : 'Ошибка сервера' },
      { status: 500 },
    );
  }
}
