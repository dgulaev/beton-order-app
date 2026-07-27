/** Клиентские константы/валидация контрактов — без supabaseAdmin. */

export const LEAD_CONTRACTS_BUCKET = 'lead-contracts';
export const LEAD_CONTRACT_MAX_BYTES = 20 * 1024 * 1024;

export const LEAD_CONTRACT_ACCEPT =
  '.pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.webp,.txt';

const ALLOWED_MIME = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/png',
  'image/jpeg',
  'image/webp',
  'text/plain',
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
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  const okExt = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'png', 'jpg', 'jpeg', 'webp', 'txt'].includes(ext);
  if (!okExt) return 'Недопустимый тип файла';
  if (file.type && !ALLOWED_MIME.has(file.type)) {
    // расширение уже проверили — пропускаем строгий mime
  }
  return null;
}
