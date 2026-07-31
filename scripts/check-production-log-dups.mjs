/**
 * Дубли production_logs за день / заявку.
 * Usage: node scripts/check-production-log-dups.mjs [YYYY-MM-DD] [orderId]
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
const orderId = process.argv[3] ? Number(process.argv[3]) : null;

const start = new Date(`${date}T00:00:00+03:00`).toISOString();
const end = new Date(`${date}T00:00:00+03:00`);
end.setDate(end.getDate() + 1);

let q = sb
  .from('production_logs')
  .select(
    'id, order_id, order_mixer_id, mixer_name, volume, start_time, end_time, created_at, operator_name, concrete_grade',
  )
  .gte('start_time', start)
  .lt('start_time', end.toISOString())
  .order('start_time', { ascending: false });

if (orderId) q = q.eq('order_id', orderId);

const { data, error } = await q;
if (error) {
  console.error('ERROR', error.message);
  process.exit(1);
}

const rows = data || [];
console.log({ date, orderId, total: rows.length });

const byOm = new Map();
for (const r of rows) {
  if (r.order_mixer_id == null) continue;
  const k = String(r.order_mixer_id);
  const list = byOm.get(k) || [];
  list.push(r);
  byOm.set(k, list);
}
const dups = [...byOm.entries()].filter(([, v]) => v.length > 1);
console.log('dup_groups_by_order_mixer_id', dups.length);
for (const [om, list] of dups) {
  console.log(
    JSON.stringify({
      order_mixer_id: om,
      order_id: list[0].order_id,
      mixer: list[0].mixer_name,
      n: list.length,
      rows: list.map((r) => ({
        id: r.id,
        vol: r.volume,
        start: r.start_time,
        end: r.end_time,
        created: r.created_at,
        operator: r.operator_name,
        durMin:
          r.start_time && r.end_time
            ? Math.round(
                ((new Date(r.end_time) - new Date(r.start_time)) / 60000) * 10,
              ) / 10
            : null,
      })),
    }),
  );
}

if (orderId) {
  console.log('ALL for order', orderId);
  for (const r of rows) {
    console.log(
      JSON.stringify({
        id: r.id,
        om: r.order_mixer_id,
        mixer: r.mixer_name,
        vol: r.volume,
        start: r.start_time,
        end: r.end_time,
        created: r.created_at,
        durMin:
          r.start_time && r.end_time
            ? Math.round(
                ((new Date(r.end_time) - new Date(r.start_time)) / 60000) * 10,
              ) / 10
            : null,
      }),
    );
  }
}

// also check order_mixers for the order
if (orderId) {
  const { data: mixers, error: mErr } = await sb
    .from('order_mixers')
    .select(
      'id, order_id, mixer_name, volume, status, time, loading_started_at, created_at',
    )
    .eq('order_id', orderId)
    .order('id');
  if (mErr) console.error('mixers err', mErr.message);
  else {
    console.log('order_mixers', mixers?.length);
    for (const m of mixers || []) console.log(JSON.stringify(m));
  }
}
