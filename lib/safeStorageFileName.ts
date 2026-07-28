/** ASCII-safe имя для ключей Supabase Storage (кириллица/пробелы → Invalid key). */

const CYR_MAP: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
  и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

function transliterate(input: string): string {
  let out = '';
  for (const ch of input) {
    const lower = ch.toLowerCase();
    if (lower in CYR_MAP) {
      const mapped = CYR_MAP[lower];
      out += ch === lower ? mapped : mapped.charAt(0).toUpperCase() + mapped.slice(1);
    } else {
      out += ch;
    }
  }
  return out;
}

/**
 * Имя файла для storage path: только [a-zA-Z0-9._-].
 * Оригинальное имя сохраняй отдельно в БД (file_name).
 */
export function safeStorageFileName(fileName: string, maxLen = 80): string {
  const base = fileName.split(/[/\\]/).pop() || 'file';
  const dot = base.lastIndexOf('.');
  const rawName = dot > 0 ? base.slice(0, dot) : base;
  const rawExt = dot > 0 ? base.slice(dot + 1) : '';

  let name = transliterate(rawName)
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[_.-]+|[_.-]+$/g, '');
  if (!name) name = 'file';

  let ext = transliterate(rawExt)
    .replace(/[^a-zA-Z0-9]+/g, '')
    .toLowerCase()
    .slice(0, 12);

  const room = Math.max(8, maxLen - (ext ? ext.length + 1 : 0));
  name = name.slice(0, room);
  return ext ? `${name}.${ext}` : name;
}
