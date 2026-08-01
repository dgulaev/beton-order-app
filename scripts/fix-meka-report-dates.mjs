/**
 * Починить meka_reports.report_date по дате из raw_data[0].date (ДД.ММ.ГГГГ).
 * Запуск: node scripts/fix-meka-report-dates.mjs
 * Dry-run: node scripts/fix-meka-report-dates.mjs --dry
 */
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

function loadEnv() {
  const p = path.join(process.cwd(), '.env.local');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const i = line.indexOf('=');
    let v = line.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    const k = line.slice(0, i).trim();
    if (!process.env[k]) process.env[k] = v;
  }
}

loadEnv();

// Подтягиваем ту же логику, что в lib (через tsx нельзя — используем копию парсера)
function pad2(n) {
  return String(n).padStart(2, '0');
}
function isValidYmd(year, month, day) {
  if (year < 2000 || year > 2100) return false;
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const dt = new Date(Date.UTC(year, month - 1, day));
  return (
    dt.getUTCFullYear() === year &&
    dt.getUTCMonth() === month - 1 &&
    dt.getUTCDate() === day
  );
}
function parseMekaDateToIso(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const y = Number(iso[1]);
    const m = Number(iso[2]);
    const d = Number(iso[3]);
    return isValidYmd(y, m, d) ? `${y}-${pad2(m)}-${pad2(d)}` : null;
  }
  const dotted = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/);
  if (!dotted) return null;
  const day = Number(dotted[1]);
  const month = Number(dotted[2]);
  let year = Number(dotted[3]);
  if (dotted[3].length === 2) year = 2000 + year;
  return isValidYmd(year, month, day)
    ? `${year}-${pad2(month)}-${pad2(day)}`
    : null;
}

const dry = process.argv.includes('--dry');
const sb = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

let from = 0;
const page = 200;
let checked = 0;
let fixed = 0;
let skipped = 0;

while (true) {
  const { data, error } = await sb
    .from('meka_reports')
    .select('id, report_date, file_name, raw_data')
    .order('id', { ascending: true })
    .range(from, from + page - 1);
  if (error) {
    console.error(error);
    process.exit(1);
  }
  if (!data?.length) break;

  for (const row of data) {
    checked += 1;
    const fromExcel = parseMekaDateToIso(row.raw_data?.[0]?.date);
    if (!fromExcel) {
      skipped += 1;
      continue;
    }
    const current = String(row.report_date || '').substring(0, 10);
    if (current === fromExcel) continue;

    console.log(
      `#${row.id} ${row.file_name}: ${current || '—'} → ${fromExcel}` +
        (dry ? ' (dry)' : ''),
    );
    if (!dry) {
      const { error: upErr } = await sb
        .from('meka_reports')
        .update({ report_date: fromExcel })
        .eq('id', row.id);
      if (upErr) {
        console.error('update failed', row.id, upErr);
        continue;
      }
    }
    fixed += 1;
  }

  if (data.length < page) break;
  from += page;
}

console.log(
  `\nГотово: проверено ${checked}, исправлено ${fixed}, без даты в Excel ${skipped}` +
    (dry ? ' [dry-run]' : ''),
);
