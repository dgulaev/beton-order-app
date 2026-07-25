/**
 * Read-only аудит силосов за день.
 * Запуск: npx tsx scripts/audit-silos-day.ts 2026-07-25
 */
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

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

function moscowDayBounds(dateKey: string): { start: string; end: string } {
  const start = new Date(`${dateKey}T00:00:00+03:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

function fmtMs(iso: string) {
  return new Date(iso).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', hour12: false });
}

function kg(n: number) {
  return Math.round(Number(n || 0) * 10) / 10;
}

function tons(n: number) {
  return Math.round(Number(n || 0) * 1000) / 1000;
}

async function main() {
  const date = process.argv[2] || '2026-07-25';
  const mekaEnd = {
    1: 48800, // кг по словам оператора
    2: 44300,
    3: 37382,
  } as Record<number, number>;

  const sb = createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const { start, end } = moscowDayBounds(date);

  console.log('=== АУДИТ СИЛОСОВ ===');
  console.log('Дата (МСК):', date);
  console.log('Окно UTC:', start, '→', end);
  console.log('');

  // Текущие остатки
  const { data: silos, error: silosErr } = await sb
    .from('warehouse_silos')
    .select('*')
    .order('silo_id');
  if (silosErr) console.error('silos error', silosErr);
  console.log('=== ТЕКУЩИЕ ОСТАТКИ warehouse_silos ===');
  for (const s of silos || []) {
    const id = Number(s.silo_id);
    const curKg = kg(Number(s.current || 0) * 1000);
    const meka = mekaEnd[id];
    console.log(
      `Силос ${id}: ${tons(s.current)} т (${curKg} кг) / max ${s.max} т | MEKA конец дня: ${meka} кг (${tons(meka / 1000)} т) | Δ склад−MEKA: ${kg(curKg - meka)} кг`,
    );
  }
  console.log('');

  // Компенсации
  const { data: comps, error: compErr } = await sb
    .from('warehouse_meka_cement_compensations')
    .select('*')
    .eq('report_date', date);
  if (compErr) console.error('comp error', compErr);
  console.log('=== КОМПЕНСАЦИИ MEKA (warehouse_meka_cement_compensations) ===');
  console.log(JSON.stringify(comps, null, 2));
  console.log('');

  // MEKA report
  const { data: reports } = await sb
    .from('meka_reports')
    .select('id, report_date, total_cement, total_volume, created_at, user_name')
    .eq('report_date', date)
    .order('id', { ascending: false });
  console.log('=== ОТЧЁТЫ MEKA ===');
  console.log(JSON.stringify(reports, null, 2));
  console.log('');

  // Все операции по силосам за день
  const { data: ops, error: opsErr } = await sb
    .from('warehouse_operations')
    .select('*')
    .ilike('item_type', '%Силос%')
    .gte('created_at', start)
    .lt('created_at', end)
    .order('created_at', { ascending: true });
  if (opsErr) console.error('ops error', opsErr);

  console.log(`=== ЖУРНАЛ warehouse_operations (${ops?.length || 0}) ===`);
  const bySilo: Record<number, any[]> = { 1: [], 2: [], 3: [] };
  for (const op of ops || []) {
    const m = String(op.item_type || '').match(/(\d+)/);
    const siloId = m ? Number(m[1]) : 0;
    const row = {
      time: fmtMs(op.created_at),
      created_at: op.created_at,
      silo: op.item_type,
      type: op.operation_type,
      amount: op.amount,
      unit: op.unit,
      old: op.old_value,
      new: op.new_value,
      delta: kg(Number(op.new_value) - Number(op.old_value)),
      user: op.user_name,
      id: op.id,
    };
    console.log(
      `${row.time} | ${row.silo} | ${row.type} | amount=${row.amount} ${row.unit} | ${row.old} → ${row.new} (Δ ${row.delta}) | ${row.user}`,
    );
    if (bySilo[siloId]) bySilo[siloId].push(row);
  }
  console.log('');

  for (const id of [1, 2, 3]) {
    const list = bySilo[id];
    console.log(`--- Сводка Силос ${id}: ${list.length} операций ---`);
    let sumDelta = 0;
    let adds = 0;
    let subs = 0;
    let compsSum = 0;
    let autoSum = 0;
    let manualSum = 0;
    for (const r of list) {
      sumDelta += r.delta;
      const u = String(r.user || '');
      if (/компенсация meka/i.test(u)) compsSum += r.delta;
      else if (/авто|заявка\s*#|задним числом/i.test(u)) autoSum += r.delta;
      else if (r.type === 'add' || r.type === 'reset') {
        if (r.type === 'add') adds += r.delta;
        manualSum += r.delta;
      } else {
        subs += r.delta;
        manualSum += r.delta;
      }
    }
    const first = list[0];
    const last = list[list.length - 1];
    console.log(`  первая: ${first ? `${first.old} → …` : 'нет'} | последняя new: ${last ? last.new : '—'}`);
    console.log(`  Σ Δ по журналу: ${kg(sumDelta)} кг`);
    console.log(`  из них компенсация MEKA: ${kg(compsSum)} кг`);
    console.log(`  из них авто/заявки (по user_name): ${kg(autoSum)} кг`);
    console.log(`  прочие/ручные: ${kg(manualSum)} кг (add-часть ${kg(adds)}, прочее ${kg(subs)})`);
    if (first && last) {
      console.log(`  old первой → new последней: ${first.old} → ${last.new} (Δ ${kg(Number(last.new) - Number(first.old))})`);
    }
    console.log(`  MEKA конец дня: ${mekaEnd[id]} | склад сейчас: см. выше`);
    console.log('');
  }

  // Автосписания с рейсов
  const { data: trips, error: tripsErr } = await sb
    .from('order_mixers')
    .select('id, order_id, cement_write_off_kg, cement_write_off_silo_id, cement_write_off_at, status')
    .not('cement_write_off_kg', 'is', null)
    .gte('cement_write_off_at', start)
    .lt('cement_write_off_at', end)
    .order('cement_write_off_at', { ascending: true });
  if (tripsErr) console.error('trips error', tripsErr);

  console.log(`=== АВТОСПИСАНИЯ order_mixers (${trips?.length || 0}) ===`);
  const tripBySilo: Record<number, number> = { 1: 0, 2: 0, 3: 0 };
  for (const t of trips || []) {
    const sid = Number(t.cement_write_off_silo_id || 0);
    const k = kg(t.cement_write_off_kg);
    if (tripBySilo[sid] != null) tripBySilo[sid] += k;
    console.log(
      `${fmtMs(t.cement_write_off_at)} | order #${t.order_id} mixer ${t.id} | silo ${sid} | −${k} кг | status=${t.status}`,
    );
  }
  console.log('Суммы автосписаний по силосам кг:', {
    1: kg(tripBySilo[1]),
    2: kg(tripBySilo[2]),
    3: kg(tripBySilo[3]),
    total: kg(tripBySilo[1] + tripBySilo[2] + tripBySilo[3]),
  });
  console.log('');

  // Экономия
  const { data: savings } = await sb
    .from('warehouse_cement_savings')
    .select('*')
    .gte('created_at', start)
    .lt('created_at', end)
    .order('created_at', { ascending: true });
  console.log('=== ЭКОНОМИЯ warehouse_cement_savings ===');
  console.log(JSON.stringify(savings, null, 2));
  console.log('');

  // Переносы
  const { data: transfers } = await sb
    .from('warehouse_operations')
    .select('*')
    .or('user_name.ilike.%перенос%,user_name.ilike.%transfer%,item_type.ilike.%перенос%')
    .gte('created_at', start)
    .lt('created_at', end)
    .order('created_at', { ascending: true });
  console.log('=== ПОХОЖИЕ НА ПЕРЕНОС ОПЕРАЦИИ ===');
  console.log(JSON.stringify(transfers, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
