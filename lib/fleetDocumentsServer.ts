import {
  FLEET_DOCUMENTS_BUCKET,
  type FleetDocument,
} from '@/lib/fleetLifecycle';
import { safeStorageFileName } from '@/lib/safeStorageFileName';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function ensureFleetDocumentsBucket(): Promise<void> {
  const { data: buckets } = await supabaseAdmin.storage.listBuckets();
  if (buckets?.some((b) => b.name === FLEET_DOCUMENTS_BUCKET)) return;
  const { error } = await supabaseAdmin.storage.createBucket(FLEET_DOCUMENTS_BUCKET, {
    public: false,
    fileSizeLimit: 20 * 1024 * 1024,
  });
  if (error && !/already exists/i.test(error.message)) {
    console.error('[fleet-documents bucket]', error.message);
  }
}

export async function createFleetDocumentSignedUrl(
  storagePath: string,
  expiresSec = 3600,
): Promise<string> {
  const { data, error } = await supabaseAdmin.storage
    .from(FLEET_DOCUMENTS_BUCKET)
    .createSignedUrl(storagePath, expiresSec);
  if (error || !data?.signedUrl) {
    throw new Error(error?.message || 'Не удалось получить ссылку на файл');
  }
  return data.signedUrl;
}

export async function uploadFleetDocumentFile(opts: {
  mixerId: number;
  docType: string;
  title?: string | null;
  expiresAt?: string | null;
  file: File | Blob;
  fileName: string;
  mimeType?: string | null;
  createdBy?: string | null;
}): Promise<FleetDocument> {
  await ensureFleetDocumentsBucket();

  const safeName = safeStorageFileName(opts.fileName);
  const storagePath = `${opts.mixerId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`;

  if (!opts.mimeType) {
    throw new Error('Не удалось определить тип файла (нужен PDF/JPEG/PNG/WebP)');
  }

  const buffer = Buffer.from(await opts.file.arrayBuffer());
  const { error: upError } = await supabaseAdmin.storage
    .from(FLEET_DOCUMENTS_BUCKET)
    .upload(storagePath, buffer, {
      contentType: opts.mimeType,
      upsert: false,
    });
  if (upError) throw new Error(upError.message);

  const { data, error } = await supabaseAdmin
    .from('fleet_documents')
    .insert({
      mixer_id: opts.mixerId,
      doc_type: opts.docType,
      title: opts.title || null,
      file_name: opts.fileName,
      storage_path: storagePath,
      mime_type: opts.mimeType || null,
      size_bytes: buffer.length,
      expires_at: opts.expiresAt || null,
      created_by: opts.createdBy || null,
    })
    .select('*')
    .single();

  if (error || !data) {
    await supabaseAdmin.storage.from(FLEET_DOCUMENTS_BUCKET).remove([storagePath]);
    throw new Error(error?.message || 'Не удалось сохранить метаданные файла');
  }

  return data as FleetDocument;
}

export async function deleteFleetDocument(doc: FleetDocument): Promise<void> {
  // Сначала Storage — при сбое строка в БД остаётся и можно повторить;
  // иначе orphan-файл без метаданных.
  const { error: storageErr } = await supabaseAdmin.storage
    .from(FLEET_DOCUMENTS_BUCKET)
    .remove([doc.storage_path]);
  if (storageErr) throw new Error(storageErr.message);
  const { error: dbErr } = await supabaseAdmin.from('fleet_documents').delete().eq('id', doc.id);
  if (dbErr) throw new Error(dbErr.message);
}

export function fleetTableMissingMessage(message: string, table: string): string {
  if (message.includes(table)) {
    return `Таблица ${table} не найдена — выполните scripts/fleet-lifecycle.sql`;
  }
  return message;
}
