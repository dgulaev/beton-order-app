/**
 * Запуск: npx tsx scripts/run-meka-compensate-date.ts 2026-07-24
 */
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { compensateMekaCementDelta } from '../lib/mekaCementCompensate';

function loadEnv() {
  const raw = fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8');
  for (const line of raw.split('\n')) {
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const i = line.indexOf('=');
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    const k = line.slice(0, i).trim();
    if (!process.env[k]) process.env[k] = v;
  }
}

loadEnv();

async function main() {
  const date = process.argv[2] || '2026-07-24';
  const sb = createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data: report, error } = await sb
    .from('meka_reports')
    .select('id, report_date, raw_data, total_cement')
    .eq('report_date', date)
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !report) {
    console.error('Отчёт MEKA не найден:', error?.message || date);
    process.exit(1);
  }

  console.log('report', report.id, 'cement', report.total_cement);
  const result = await compensateMekaCementDelta({
    reportDate: date,
    mekaReportId: Number(report.id),
    rawData: report.raw_data,
    userName: 'Дозапуск компенсации',
  });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
