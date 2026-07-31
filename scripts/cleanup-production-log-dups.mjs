/**
 * Удаляет дубли production_logs: оставляет max(id) на order_mixer_id.
 * Usage: node scripts/cleanup-production-log-dups.mjs [--dry]
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
const dry = process.argv.includes('--dry');

const { data, error } = await sb
  .from('production_logs')
  .select('id, order_id, order_mixer_id, mixer_name, created_at')
  .not('order_mixer_id', 'is', null)
  .order('id', { ascending: true });

if (error) {
  console.error(error.message);
  process.exit(1);
}

const best = new Map();
const toDelete = [];
for (const r of data || []) {
  const k = String(r.order_mixer_id);
  const prev = best.get(k);
  if (!prev) {
    best.set(k, r);
    continue;
  }
  // оставляем больший id
  if (Number(r.id) > Number(prev.id)) {
    toDelete.push(prev);
    best.set(k, r);
  } else {
    toDelete.push(r);
  }
}

console.log({
  total: (data || []).length,
  uniqueMixers: best.size,
  deleteCount: toDelete.length,
  dry,
  sample: toDelete.slice(0, 20).map((r) => ({
    id: r.id,
    order: r.order_id,
    om: r.order_mixer_id,
    mixer: r.mixer_name,
  })),
});

if (dry || toDelete.length === 0) process.exit(0);

for (let i = 0; i < toDelete.length; i += 50) {
  const ids = toDelete.slice(i, i + 50).map((r) => r.id);
  const { error: delErr } = await sb.from('production_logs').delete().in('id', ids);
  if (delErr) {
    console.error('delete failed', delErr.message);
    process.exit(1);
  }
  console.log('deleted', ids.length);
}
console.log('done');
