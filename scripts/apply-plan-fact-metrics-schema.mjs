/**
 * Применяет scripts/plan-fact-metrics-schema.sql через Supabase SQL API
 * (нужен доступ к Management / postgres — fallback: проверка таблиц).
 *
 * Usage: node scripts/apply-plan-fact-metrics-schema.mjs
 */
import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

const env = fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const get = (k) => {
  const m = env.match(new RegExp(`^${k}=(.*)$`, 'm'));
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : null;
};
const url = get('NEXT_PUBLIC_SUPABASE_URL') || get('SUPABASE_URL');
const key = get('SUPABASE_SERVICE_ROLE_KEY');
const sb = createClient(url, key);

async function tableExists(name) {
  const { error } = await sb.from(name).select('*').limit(1);
  if (!error) return true;
  if (/does not exist/i.test(error.message || '')) return false;
  // RLS / empty ok
  return !/relation|schema cache/i.test(error.message || '');
}

const hasMetrics = await tableExists('plan_fact_trip_metrics');
const hasCalib = await tableExists('planner_calibration_current');
const { error: morningErr } = await sb
  .from('daily_logistics_plans')
  .select('morning_payload')
  .limit(1);
const hasMorning = !morningErr || !/morning_/i.test(morningErr.message || '');

console.log({ hasMetrics, hasCalib, hasMorning, morningErr: morningErr?.message });

if (hasMetrics && hasCalib && hasMorning) {
  console.log('OK: схема V2 уже применена');
  process.exit(0);
}

console.log(
  'NEED: выполни вручную scripts/plan-fact-metrics-schema.sql в Supabase SQL Editor',
);
process.exit(2);
