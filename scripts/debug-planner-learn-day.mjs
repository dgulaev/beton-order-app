/**
 * Диагностика: почему learn не пишет plan_fact_trip_metrics.
 * Usage: node scripts/debug-planner-learn-day.mjs [YYYY-MM-DD]
 */
import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

const env = fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const get = (k) => {
  const m = env.match(new RegExp(`^${k}=(.*)$`, 'm'));
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : null;
};
const sb = createClient(
  get('NEXT_PUBLIC_SUPABASE_URL') || get('SUPABASE_URL'),
  get('SUPABASE_SERVICE_ROLE_KEY'),
);

const date =
  process.argv[2] ||
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

console.log('date', date);

const plan = await sb
  .from('daily_logistics_plans')
  .select('delivery_date, revision, morning_payload, morning_captured_at, payload')
  .eq('delivery_date', date)
  .maybeSingle();
console.log('plan err', plan.error?.message);
const row = plan.data;
if (!row) {
  console.log('NO PLAN ROW');
} else {
  const morningTrips = row.morning_payload?.trips;
  const lateTrips = row.payload?.trips;
  console.log({
    revision: row.revision,
    morningAt: row.morning_captured_at,
    morningTrips: Array.isArray(morningTrips) ? morningTrips.length : null,
    lateTrips: Array.isArray(lateTrips) ? lateTrips.length : null,
    hasMorning: Boolean(row.morning_payload),
  });
}

const metrics = await sb
  .from('plan_fact_trip_metrics')
  .select('id, delivery_date, plan_trip_id, match_kind, snapshot_quality')
  .eq('delivery_date', date);
console.log('metrics err', metrics.error?.message);
console.log('metrics count', (metrics.data || []).length);

const anyMetrics = await sb
  .from('plan_fact_trip_metrics')
  .select('delivery_date')
  .order('delivery_date', { ascending: false })
  .limit(20);
console.log('any metrics sample dates', [
  ...new Set((anyMetrics.data || []).map((r) => r.delivery_date)),
]);
console.log('any metrics err', anyMetrics.error?.message);

const calib = await sb
  .from('planner_calibration_current')
  .select('*')
  .eq('id', 1)
  .maybeSingle();
console.log('calib', {
  err: calib.error?.message,
  samples: calib.data?.samples,
  days: calib.data?.days_used,
  updated: calib.data?.updated_at,
  payloadKeys: calib.data?.payload ? Object.keys(calib.data.payload) : null,
  payload: calib.data?.payload,
});

// count plans with trips in last 45 days
const today = date;
const from = new Date(`${today}T12:00:00+03:00`);
from.setDate(from.getDate() - 44);
const fromStr = from.toISOString().slice(0, 10);
const plans = await sb
  .from('daily_logistics_plans')
  .select('delivery_date, payload, morning_payload')
  .gte('delivery_date', fromStr)
  .lte('delivery_date', today);
console.log('plans in window err', plans.error?.message);
let withTrips = 0;
const dates = [];
for (const p of plans.data || []) {
  const n =
    (Array.isArray(p.morning_payload?.trips) && p.morning_payload.trips.length) ||
    (Array.isArray(p.payload?.trips) && p.payload.trips.length) ||
    0;
  if (n > 0) {
    withTrips += 1;
    dates.push(`${p.delivery_date}:${n}`);
  }
}
console.log({ plansTotal: (plans.data || []).length, withTrips, dates });
