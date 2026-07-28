/** Клиентские константы/валидация контрактов — без supabaseAdmin. */

export const LEAD_CONTRACTS_BUCKET = 'lead-contracts';
export const LEAD_CONTRACT_MAX_BYTES = 20 * 1024 * 1024;

/** PDF и архивы — остальные типы отсекаем. */
export const LEAD_CONTRACT_ALLOWED_EXT = [
  'pdf',
  'zip',
  'rar',
  '7z',
  'tar',
  'gz',
  'tgz',
  'bz2',
] as const;

export const LEAD_CONTRACT_ACCEPT = '.pdf,.zip,.rar,.7z,.tar,.gz,.tgz,.bz2';

const ALLOWED_MIME = new Set([
  'application/pdf',
  'application/zip',
  'application/x-zip-compressed',
  'application/x-rar-compressed',
  'application/vnd.rar',
  'application/x-7z-compressed',
  'application/x-tar',
  'application/gzip',
  'application/x-gzip',
  'application/x-bzip2',
  'application/octet-stream',
]);

export type LeadContract = {
  id: number;
  lead_id: number;
  file_name: string;
  storage_path: string;
  mime_type: string | null;
  size_bytes: number | null;
  uploaded_by: number | null;
  uploaded_by_name: string | null;
  created_at: string;
};

export function isAllowedContractFile(file: { name: string; type: string; size: number }): string | null {
  if (file.size <= 0) return 'Пустой файл';
  if (file.size > LEAD_CONTRACT_MAX_BYTES) return 'Файл больше 20 МБ';
  const lower = file.name.toLowerCase();
  const ext = lower.endsWith('.tar.gz')
    ? 'tar.gz'
    : lower.split('.').pop() || '';
  const okExt =
    (LEAD_CONTRACT_ALLOWED_EXT as readonly string[]).includes(ext) || ext === 'tar.gz';
  if (!okExt) {
    return 'Допустимы только PDF и архивы (zip, rar, 7z, tar, gz)';
  }
  if (file.type && !ALLOWED_MIME.has(file.type)) {
    // расширение уже проверили — пропускаем строгий mime (браузеры часто шлют octet-stream)
  }
  return null;
}
