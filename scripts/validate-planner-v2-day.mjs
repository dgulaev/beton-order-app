/**
 * Отчёт план/факт за дату (по умолчанию сегодня МСК) — приёмка V2.
 * Usage: node scripts/validate-planner-v2-day.mjs [YYYY-MM-DD]
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

const today =
  process.argv[2] ||
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function r1(n) {
  if (n == null || !Number.isFinite(n)) return null;
  return Math.round(n * 10) / 10;
}

const { data, error } = await sb
  .from('plan_fact_trip_metrics')
  .select('*')
  .eq('delivery_date', today);

if (error) {
  console.error('ERROR', error.message);
  console.error('Нужен scripts/plan-fact-metrics-schema.sql + learn backfill');
  process.exit(1);
}

const rows = data || [];
const matched = rows.filter((r) => r.match_kind !== 'none');
const loadFact = matched.map((r) => Number(r.fact_load_dur_min)).filter((n) => n > 0);
const loadPlan = matched.map((r) => Number(r.plan_load_min)).filter((n) => n > 0);
const deltaStart = matched
  .map((r) => Number(r.delta_load_start_min))
  .filter((n) => Number.isFinite(n));
const cycle = matched.map((r) => Number(r.delta_cycle_min)).filter((n) => Number.isFinite(n));

console.log('=== V2 validate', today, '===');
console.log({
  trips: rows.length,
  matched: matched.length,
  morningSnap: rows.filter((r) => r.snapshot_quality === 'morning').length,
  lateSnap: rows.filter((r) => r.snapshot_quality === 'late').length,
  medianLoadFact: r1(median(loadFact)),
  medianLoadPlan: r1(median(loadPlan)),
  earlyStartPct:
    deltaStart.length > 0
      ? Math.round((100 * deltaStart.filter((d) => d < -5).length) / deltaStart.length)
      : null,
  lateStartPct:
    deltaStart.length > 0
      ? Math.round((100 * deltaStart.filter((d) => d > 5).length) / deltaStart.length)
      : null,
  medianCycleDelta: r1(median(cycle)),
});

const { data: calib } = await sb
  .from('planner_calibration_current')
  .select('payload, samples, days_used, updated_at')
  .eq('id', 1)
  .maybeSingle();
console.log('calibration', {
  samples: calib?.samples,
  days: calib?.days_used,
  loadP50: calib?.payload?.loadP50,
  unloadP50: calib?.payload?.unloadP50,
  updated: calib?.updated_at,
});
