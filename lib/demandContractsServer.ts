import {
  DEMAND_CONTRACT_MAX_BYTES,
  DEMAND_CONTRACTS_BUCKET,
  type DemandContract,
} from '@/lib/demandContracts';
import { uploadLeadContractFile } from '@/lib/leadContractsServer';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function ensureDemandContractsBucket(): Promise<void> {
  const { data: buckets } = await supabaseAdmin.storage.listBuckets();
  if (buckets?.some((b) => b.name === DEMAND_CONTRACTS_BUCKET)) return;
  const { error } = await supabaseAdmin.storage.createBucket(DEMAND_CONTRACTS_BUCKET, {
    public: false,
    fileSizeLimit: DEMAND_CONTRACT_MAX_BYTES,
  });
  if (error && !/already exists/i.test(error.message)) {
    console.error('[demand-contracts bucket]', error.message);
  }
}

export async function createDemandContractSignedUrl(
  storagePath: string,
  expiresSec = 3600,
): Promise<string> {
  const { data, error } = await supabaseAdmin.storage
    .from(DEMAND_CONTRACTS_BUCKET)
    .createSignedUrl(storagePath, expiresSec);
  if (error || !data?.signedUrl) {
    throw new Error(error?.message || 'Не удалось получить ссылку на файл');
  }
  return data.signedUrl;
}

export async function uploadDemandContractFile(opts: {
  demandId: number;
  file: File | Blob;
  fileName: string;
  mimeType?: string | null;
  uploadedBy: number;
  uploadedByName: string;
}): Promise<DemandContract> {
  await ensureDemandContractsBucket();

  const safeName = opts.fileName.replace(/[^\w.\-а-яА-ЯёЁ ]+/gi, '_').slice(0, 120);
  const storagePath = `${opts.demandId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`;

  const buffer = Buffer.from(await opts.file.arrayBuffer());
  const { error: upError } = await supabaseAdmin.storage
    .from(DEMAND_CONTRACTS_BUCKET)
    .upload(storagePath, buffer, {
      contentType: opts.mimeType || 'application/octet-stream',
      upsert: false,
    });
  if (upError) throw new Error(upError.message);

  const { data, error } = await supabaseAdmin
    .from('demand_contracts')
    .insert({
      demand_id: opts.demandId,
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
    await supabaseAdmin.storage.from(DEMAND_CONTRACTS_BUCKET).remove([storagePath]);
    throw new Error(error?.message || 'Не удалось сохранить метаданные файла');
  }

  return data as DemandContract;
}

/** Копирует файлы спроса в lead_contracts и удаляет временные на demand. */
export async function transferDemandContractsToLead(opts: {
  demandId: number;
  leadId: number;
  uploadedBy: number;
  uploadedByName: string;
}): Promise<number> {
  const { data: rows, error } = await supabaseAdmin
    .from('demand_contracts')
    .select('*')
    .eq('demand_id', opts.demandId);

  if (error) throw new Error(error.message);
  if (!rows?.length) return 0;

  let transferred = 0;
  const failed: string[] = [];
  for (const row of rows as DemandContract[]) {
    const { data: blob, error: dlError } = await supabaseAdmin.storage
      .from(DEMAND_CONTRACTS_BUCKET)
      .download(row.storage_path);
    if (dlError || !blob) {
      console.error('[transfer demand contract]', row.id, dlError?.message);
      failed.push(row.file_name);
      continue;
    }

    try {
      await uploadLeadContractFile({
        leadId: opts.leadId,
        file: blob,
        fileName: row.file_name,
        mimeType: row.mime_type,
        uploadedBy: row.uploaded_by ?? opts.uploadedBy,
        uploadedByName: row.uploaded_by_name || opts.uploadedByName,
      });
      await supabaseAdmin.from('demand_contracts').delete().eq('id', row.id);
      await supabaseAdmin.storage.from(DEMAND_CONTRACTS_BUCKET).remove([row.storage_path]);
      transferred += 1;
    } catch (e) {
      console.error('[transfer demand contract upload]', row.id, e);
      failed.push(row.file_name);
    }
  }

  if (failed.length > 0) {
    throw new Error(
      `Не перенесены файлы (${failed.length}): ${failed.slice(0, 3).join(', ')}` +
        (failed.length > 3 ? '…' : ''),
    );
  }

  return transferred;
}
