-- Обновить MIME buckets под PDF + архивы (zip/rar/7z…).
-- Выполнить в Supabase SQL Editor один раз.

update storage.buckets
set allowed_mime_types = array[
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
  'application/octet-stream'
]
where id in ('lead-contracts', 'demand-contracts');
