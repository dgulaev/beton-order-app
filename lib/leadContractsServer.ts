import {
  LEAD_CONTRACT_MAX_BYTES,
  LEAD_CONTRACTS_BUCKET,
  type LeadContract,
} from '@/lib/leadContracts';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function ensureLeadContractsBucket(): Promise<void> {
  const { data: buckets } = await supabaseAdmin.storage.listBuckets();
  if (buckets?.some((b) => b.name === LEAD_CONTRACTS_BUCKET)) return;
  const { error } = await supabaseAdmin.storage.createBucket(LEAD_CONTRACTS_BUCKET, {
    public: false,
    fileSizeLimit: LEAD_CONTRACT_MAX_BYTES,
  });
  if (error && !/already exists/i.test(error.message)) {
    console.error('[lead-contracts bucket]', error.message);
  }
}

export async function uploadLeadContractFile(opts: {
  leadId: number;
  file: File | Blob;
  fileName: string;
  mimeType?: string | null;
  uploadedBy: number;
  uploadedByName: string;
}): Promise<LeadContract> {
  await ensureLeadContractsBucket();

  const safeName = opts.fileName.replace(/[^\w.\-а-яА-ЯёЁ ]+/gi, '_').slice(0, 120);
  const storagePath = `${opts.leadId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`;

  const buffer = Buffer.from(await opts.file.arrayBuffer());
  const { error: upError } = await supabaseAdmin.storage
    .from(LEAD_CONTRACTS_BUCKET)
    .upload(storagePath, buffer, {
      contentType: opts.mimeType || 'application/octet-stream',
      upsert: false,
    });
  if (upError) throw new Error(upError.message);

  const { data, error } = await supabaseAdmin
    .from('lead_contracts')
    .insert({
      lead_id: opts.leadId,
      file_name: opts.fileName,
      storage_path: storagePath,
      mime_type: opts.mimeType || null,
      size_bytes: buffer.length,
      uploaded_by: opts.uploadedBy,
      uploaded_by_name: opts.uploadedByName,
    })
    .select('*')
    .single();

  if (error || !data) {
    await supabaseAdmin.storage.from(LEAD_CONTRACTS_BUCKET).remove([storagePath]);
    throw new Error(error?.message || 'Не удалось сохранить метаданные файла');
  }

  return data as LeadContract;
}

export async function createContractSignedUrl(storagePath: string, expiresSec = 3600): Promise<string> {
  const { data, error } = await supabaseAdmin.storage
    .from(LEAD_CONTRACTS_BUCKET)
    .createSignedUrl(storagePath, expiresSec);
  if (error || !data?.signedUrl) {
    throw new Error(error?.message || 'Не удалось получить ссылку на файл');
  }
  return data.signedUrl;
}
