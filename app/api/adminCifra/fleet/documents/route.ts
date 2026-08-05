import { NextRequest, NextResponse } from 'next/server';
import { FLEET_MUTATION_ROLES, requireAdminCifraStaff } from '@/lib/adminCifraAuth';
import {
  FLEET_DOC_TYPES,
  isAllowedFleetDocument,
  isFleetDocType,
  resolveFleetDocumentMime,
  type FleetDocument,
} from '@/lib/fleetLifecycle';
import {
  createFleetDocumentSignedUrl,
  deleteFleetDocument,
  fleetTableMissingMessage,
  uploadFleetDocumentFile,
} from '@/lib/fleetDocumentsServer';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

/** GET — документы ТС (?mixer_id=) */
export async function GET(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request);
  if (auth.error) return auth.error;

  const mixerId = Number(request.nextUrl.searchParams.get('mixer_id'));
  if (!Number.isFinite(mixerId) || mixerId <= 0) {
    return NextResponse.json({ success: false, error: 'mixer_id обязателен' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('fleet_documents')
    .select('*')
    .eq('mixer_id', mixerId)
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json(
      { success: false, error: fleetTableMissingMessage(error.message, 'fleet_documents') },
      { status: 500 },
    );
  }

  const documents: Array<FleetDocument & { url?: string }> = [];
  for (const row of (data ?? []) as FleetDocument[]) {
    try {
      const url = await createFleetDocumentSignedUrl(row.storage_path, 3600);
      documents.push({ ...row, url });
    } catch {
      documents.push(row);
    }
  }

  return NextResponse.json({ success: true, documents, docTypes: FLEET_DOC_TYPES });
}

/** POST — загрузка документа (FormData) */
export async function POST(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request, FLEET_MUTATION_ROLES);
  if (auth.error) return auth.error;

  try {
    const form = await request.formData();
    const mixerId = Number(form.get('mixer_id'));
    const docType = String(form.get('doc_type') || '');
    const title = form.get('title') ? String(form.get('title')) : null;
    const expiresAt = form.get('expires_at') ? String(form.get('expires_at')) : null;
    const file = form.get('file');

    if (!Number.isFinite(mixerId) || mixerId <= 0) {
      return NextResponse.json({ success: false, error: 'mixer_id обязателен' }, { status: 400 });
    }
    if (!isFleetDocType(docType)) {
      return NextResponse.json({ success: false, error: 'Некорректный тип документа' }, { status: 400 });
    }
    if (!(file instanceof File)) {
      return NextResponse.json({ success: false, error: 'Файл обязателен' }, { status: 400 });
    }

    const bad = isAllowedFleetDocument(file);
    if (bad) {
      return NextResponse.json({ success: false, error: bad }, { status: 400 });
    }

    const mimeType = resolveFleetDocumentMime(file);
    const doc = await uploadFleetDocumentFile({
      mixerId,
      docType,
      title,
      expiresAt,
      file,
      fileName: file.name,
      mimeType,
      createdBy: auth.user.full_name || 'Сотрудник',
    });

    if (expiresAt) {
      const docLabel = FLEET_DOC_TYPES.find((d) => d.value === docType)?.label ?? docType;
      const dueDate = expiresAt.slice(0, 10);
      // Не плодим дубли document_expiry на ту же дату
      const { data: existingRem } = await supabaseAdmin
        .from('fleet_reminders')
        .select('id')
        .eq('mixer_id', mixerId)
        .eq('kind', 'document_expiry')
        .eq('due_date', dueDate)
        .eq('status', 'pending')
        .limit(1);
      if (!existingRem?.length) {
        await supabaseAdmin.from('fleet_reminders').insert({
          mixer_id: mixerId,
          kind: 'document_expiry',
          title: `${docLabel} истекает`,
          due_date: dueDate,
          status: 'pending',
        });
      }
    }

    let url: string | undefined;
    try {
      url = await createFleetDocumentSignedUrl(doc.storage_path, 3600);
    } catch {
      /* optional */
    }

    return NextResponse.json({ success: true, document: { ...doc, url } });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Ошибка загрузки';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

/** DELETE — ?id= */
export async function DELETE(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request, FLEET_MUTATION_ROLES);
  if (auth.error) return auth.error;

  const id = Number(request.nextUrl.searchParams.get('id'));
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ success: false, error: 'id обязателен' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('fleet_documents')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { success: false, error: fleetTableMissingMessage(error.message, 'fleet_documents') },
      { status: 500 },
    );
  }
  if (!data) {
    return NextResponse.json({ success: false, error: 'Не найдено' }, { status: 404 });
  }

  try {
    await deleteFleetDocument(data as FleetDocument);
    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Ошибка удаления';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
