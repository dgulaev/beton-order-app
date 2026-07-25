import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

function loadEnv() {
  const raw = fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8');
  for (const line of raw.split('\n')) {
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const i = line.indexOf('=');
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    const k = line.slice(0, i).trim();
    if (!process.env[k]) process.env[k] = v;
  }
}
loadEnv();

async function main() {
  const sb = createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const date = '2026-07-25';
  const start = new Date(`${date}T00:00:00+03:00`).toISOString();
  const end = new Date(new Date(start).getTime() + 86400000).toISOString();

  const r = await sb.from('meka_reports').select('id, report_date, total_cement, total_volume, created_at').eq('id', 113).maybeSingle();
  console.log('report 113', JSON.stringify(r, null, 2));

  const r2 = await sb
    .from('meka_reports')
    .select('id, report_date, total_cement, created_at')
    .gte('created_at', start)
    .lt('created_at', end)
    .order('id');
  console.log('reports created today', JSON.stringify(r2.data, null, 2));

  // parse cement from raw for report 113
  const full = await sb.from('meka_reports').select('id, report_date, total_cement, raw_data, created_at').eq('id', 113).maybeSingle();
  const rows = Array.isArray(full.data?.raw_data) ? full.data!.raw_data : [];
  let cement = 0;
  let n = 0;
  for (const row of rows) {
    const c = Number((row as any).cement || 0);
    if (c > 0) {
      cement += c;
      n += 1;
    }
  }
  console.log('raw cement sum', Math.round(cement * 10) / 10, 'batches', n, 'total_cement field', full.data?.total_cement, 'report_date', full.data?.report_date, 'created', full.data?.created_at);

  const prev3 = await sb
    .from('warehouse_operations')
    .select('created_at,operation_type,amount,old_value,new_value,user_name')
    .ilike('item_type', '%Силос 3%')
    .lt('created_at', start)
    .order('created_at', { ascending: false })
    .limit(3);
  console.log('silo3 before today', JSON.stringify(prev3.data, null, 2));

  const atComp = '2026-07-25T14:42:29.820392+00:00';
  const trips = await sb
    .from('order_mixers')
    .select('id, order_id, cement_write_off_kg, cement_write_off_silo_id, cement_write_off_at')
    .not('cement_write_off_kg', 'is', null)
    .gte('cement_write_off_at', start)
    .lte('cement_write_off_at', atComp);
  let sum = 0;
  const by: Record<number, number> = { 1: 0, 2: 0, 3: 0 };
  for (const t of trips.data || []) {
    const k = Number(t.cement_write_off_kg);
    sum += k;
    const sid = Number(t.cement_write_off_silo_id);
    by[sid] = (by[sid] || 0) + k;
  }
  console.log('trips up to compensation moment', {
    count: trips.data?.length,
    sum: Math.round(sum * 10) / 10,
    by,
    warehouse_kg_recorded_in_comp: 54060,
    meka_kg: 54603,
    delta: 543,
  });

  // journal subtracts until compensation (exclude compensation and after)
  const ops = await sb
    .from('warehouse_operations')
    .select('*')
    .ilike('item_type', '%Силос%')
    .gte('created_at', start)
    .lte('created_at', atComp)
    .order('created_at');
  let journalSub = 0;
  let journalAddNet = 0;
  for (const o of ops.data || []) {
    const d = Number(o.new_value) - Number(o.old_value);
    if (String(o.user_name || '').includes('Компенсация')) continue;
    if (o.operation_type === 'subtract') journalSub += Number(o.amount || 0);
    journalAddNet += d;
  }
  console.log('journal until comp (excl compensation rows themselves in loop by time):', {
    ops: ops.data?.length,
    subtractAmountsSum: Math.round(journalSub * 10) / 10,
  });

  // show silo1 state just before compensation
  const s1 = (ops.data || []).filter((o) => String(o.item_type).includes('Силос 1'));
  const lastS1 = s1[s1.length - 1];
  console.log('last silo1 op at/before comp time:', lastS1 && {
    time: lastS1.created_at,
    type: lastS1.operation_type,
    old: lastS1.old_value,
    new: lastS1.new_value,
    user: lastS1.user_name,
  });

  const m = await sb
    .from('order_mixers')
    .select('id, order_id, volume, cement_write_off_kg, cement_write_off_silo_id, cement_write_off_at, status')
    .eq('id', 1111)
    .maybeSingle();
  console.log('mixer 1111', JSON.stringify(m.data, null, 2));

  // How refill works - check if 48800 was absolute set
  const refill = await sb
    .from('warehouse_operations')
    .select('*')
    .eq('operation_type', 'add')
    .ilike('item_type', '%Силос 1%')
    .gte('created_at', start)
    .lt('created_at', end)
    .order('created_at');
  console.log('silo1 adds today:');
  for (const o of refill.data || []) {
    console.log(
      new Date(o.created_at).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', hour12: false }),
      o.old_value,
      '->',
      o.new_value,
      'amount',
      o.amount,
      o.user_name,
    );
  }

  // Reconstruct: if no compensation, silo1 would be 48800; after + trip 677 on silo3
  console.log('\n=== РЕКОНСТРУКЦИЯ ===');
  console.log('17:30:39 Семён внёс остаток Силос 1 = 48800 кг (совпадает с MEKA конец дня)');
  console.log('17:42:30 Компенсация MEKA списала с Силос 1 ещё 478.1 кг → 48321.9');
  console.log('Разница склад сейчас vs MEKA силос1: 48321.9 - 48800 = -478.1 кг — ровно компенсация');
  console.log('Силос 2: 44300 = MEKA, совпало (компенсации на него не было)');
  console.log('Силос 3: после компенсации 38520.1, затем −1200 (#677) → 37320.1; MEKA 37382; Δ −61.9 ≈ компенсация 64.9 минус небольшой рассинхрон');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
