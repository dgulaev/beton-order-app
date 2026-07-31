/**
 * Прогнать learn одного дня и показать реальную ошибку.
 * Usage: node scripts/try-learn-day.mjs [YYYY-MM-DD]
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

const date = process.argv[2] || '2026-07-31';

const { data: planRow, error: planErr } = await sb
  .from('daily_logistics_plans')
  .select('payload, morning_payload')
  .eq('delivery_date', date)
  .maybeSingle();
if (planErr) {
  console.error('plan', planErr);
  process.exit(1);
}
const trips =
  planRow?.morning_payload?.trips || planRow?.payload?.trips || [];
console.log('trips', trips.length);

const { data: orders, error: oErr } = await sb
  .from('orders')
  .select('id')
  .eq('delivery_date', date)
  .neq('status', 'cancelled');
console.log('orders', oErr?.message, (orders || []).length);

const orderIds = (orders || []).map((o) => o.id);
const { data: mixers, error: mErr } = await sb
  .from('order_mixers')
  .select(
    'id, order_id, mixer_name, volume, status, time, loading_started_at, on_site_at, unloaded_at',
  )
  .in('order_id', orderIds.slice(0, 50));
console.log('mixers', mErr?.message, (mixers || []).length);

const start = new Date(`${date}T00:00:00+03:00`).toISOString();
const end = new Date(`${date}T00:00:00+03:00`);
end.setDate(end.getDate() + 1);
const endIso = end.toISOString();

const logsFull = await sb
  .from('production_logs')
  .select(
    'id, order_id, order_mixer_id, start_time, end_time, mixer_name, volume, no_operator_record, delivery_date',
  )
  .gte('start_time', start)
  .lt('start_time', endIso);
console.log('logs with no_operator_record', logsFull.error?.message, (logsFull.data || []).length);

const logsOk = await sb
  .from('production_logs')
  .select('id, order_id, order_mixer_id, start_time, end_time, mixer_name, volume')
  .gte('start_time', start)
  .lt('start_time', endIso);
console.log('logs basic', logsOk.error?.message, (logsOk.data || []).length);

// try minimal upsert one fake-shaped row from first trip
if (trips[0]) {
  const t = trips[0];
  const row = {
    delivery_date: date,
    plan_trip_id: String(t.id),
    order_id: Number(t.orderId) || null,
    order_mixer_id: null,
    mixer_number: t.mixerNumber || null,
    volume_m3: Number(t.volume) || null,
    plan_load_at: t.loadTime || null,
    plan_arrive_at: t.arriveTime || null,
    plan_load_min: Number(t.loadMin) || null,
    plan_road_min: Number(t.roadMin) || null,
    plan_unload_min: Number(t.unloadMin) || null,
    fact_load_start: null,
    fact_release_at: null,
    fact_on_site_at: null,
    fact_unloaded_at: null,
    delta_load_start_min: null,
    fact_load_dur_min: null,
    fact_road_min: null,
    fact_onsite_min: null,
    delta_cycle_min: null,
    match_kind: 'none',
    no_operator: false,
    snapshot_quality: 'late',
    computed_at: new Date().toISOString(),
  };
  const up = await sb
    .from('plan_fact_trip_metrics')
    .upsert([row], { onConflict: 'delivery_date,plan_trip_id' })
    .select('id');
  console.log('upsert test', up.error?.message || 'OK', up.data);
}
