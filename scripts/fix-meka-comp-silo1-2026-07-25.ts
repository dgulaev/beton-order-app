/**
 * Разовая починка 25.07.2026: компенсация −478.1 кг ошибочно списалась
 * с силоса 1 уже после пополнения из минуса. Возвращаем остаток и
 * дописываем сумму в экономию (sink=savings).
 *
 * Запуск: npx tsx scripts/fix-meka-comp-silo1-2026-07-25.ts
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

const REPORT_DATE = '2026-07-25';
const SILO_ID = 1;
const KG = 478.1;
const EXPECTED_AFTER = 48800;

async function main() {
  const sb = createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data: silo, error: siloErr } = await sb
    .from('warehouse_silos')
    .select('silo_id, current')
    .eq('silo_id', SILO_ID)
    .maybeSingle();
  if (siloErr || !silo) {
    console.error('Силос не найден', siloErr);
    process.exit(1);
  }

  const curKg = Math.round(Number(silo.current || 0) * 1000 * 10) / 10;
  console.log('Силос 1 сейчас:', curKg, 'кг');

  if (Math.abs(curKg - EXPECTED_AFTER) < 0.15) {
    console.log('Остаток уже 48800 — возможно починка уже применена. Проверяю sink…');
  } else if (Math.abs(curKg - (EXPECTED_AFTER - KG)) > 1) {
    console.error(
      `Неожиданный остаток ${curKg}: ожидалось ~${EXPECTED_AFTER - KG} (после ошибочной компенсации). Стоп.`,
    );
    process.exit(1);
  }

  const { data: comp, error: compErr } = await sb
    .from('warehouse_meka_cement_compensations')
    .select('id, by_silo, status')
    .eq('report_date', REPORT_DATE)
    .maybeSingle();
  if (compErr || !comp) {
    console.error('Компенсация за день не найдена', compErr);
    process.exit(1);
  }

  const bySilo = Array.isArray(comp.by_silo) ? [...comp.by_silo] : [];
  const row = bySilo.find((r: any) => Number(r.siloId) === SILO_ID);
  if (!row) {
    console.error('В by_silo нет силоса 1');
    process.exit(1);
  }
  if (row.sink === 'savings' && Math.abs(curKg - EXPECTED_AFTER) < 0.15) {
    console.log('Уже исправлено (sink=savings, остаток 48800). Выход.');
    return;
  }

  // 1) Вернуть кг на силос (если ещё не вернули)
  let newKg = curKg;
  if (Math.abs(curKg - EXPECTED_AFTER) >= 0.15) {
    const deltaTons = KG / 1000;
    const { data: adjRows, error: rpcError } = await sb.rpc('warehouse_silo_adjust', {
      p_silo_id: SILO_ID,
      p_delta_tons: deltaTons,
    });
    if (rpcError) {
      console.error('warehouse_silo_adjust:', rpcError);
      process.exit(1);
    }
    const adj = Array.isArray(adjRows) ? adjRows[0] : adjRows;
    newKg = Math.round(Number(adj?.new_current ?? 0) * 1000 * 10) / 10;
    console.log('Adjust:', adj?.old_current, '→', adj?.new_current, 'т (', newKg, 'кг)');
  }

  // 2) Экономия (если ещё нет такой записи meka_reconcile 478.1 за день)
  const dayStart = new Date(`${REPORT_DATE}T00:00:00+03:00`).toISOString();
  const dayEnd = new Date(new Date(`${REPORT_DATE}T00:00:00+03:00`).getTime() + 86400000).toISOString();
  const { data: existingSav } = await sb
    .from('warehouse_cement_savings')
    .select('id')
    .eq('silo_id', SILO_ID)
    .eq('reason', 'meka_reconcile')
    .eq('amount_kg', KG)
    .gte('created_at', dayStart)
    .lt('created_at', dayEnd)
    .limit(1);

  if (!existingSav?.length) {
    const { error: savErr } = await sb.from('warehouse_cement_savings').insert({
      silo_id: SILO_ID,
      amount_kg: KG,
      reason: 'meka_reconcile',
      balance_before_tons: -1.296,
      user_name: 'Исправление компенсации 25.07.2026',
    });
    if (savErr) {
      console.error('savings insert:', savErr);
      process.exit(1);
    }
    console.log('Экономия +', KG, 'кг записана');
  } else {
    console.log('Экономия meka_reconcile', KG, 'уже есть, id', existingSav[0].id);
  }

  // 3) Журнал
  await sb.from('warehouse_operations').insert({
    operation_type: 'add',
    item_type: 'Силос 1',
    amount: KG,
    old_value: curKg,
    new_value: newKg,
    unit: 'кг',
    user_name: 'Исправление: компенсация MEKA → экономия · 25.07.2026 · Силос 1',
  });
  console.log('Журнал записан');

  // 4) by_silo sink=savings
  const nextBySilo = bySilo.map((r: any) =>
    Number(r.siloId) === SILO_ID
      ? { ...r, sink: 'savings' }
      : { ...r, sink: r.sink || 'balance' },
  );
  const { error: updErr } = await sb
    .from('warehouse_meka_cement_compensations')
    .update({ by_silo: nextBySilo })
    .eq('id', comp.id);
  if (updErr) {
    console.error('update by_silo:', updErr);
    process.exit(1);
  }
  console.log('by_silo обновлён:', JSON.stringify(nextBySilo, null, 2));

  const { data: after } = await sb
    .from('warehouse_silos')
    .select('current')
    .eq('silo_id', SILO_ID)
    .maybeSingle();
  console.log('Итог силос 1:', Math.round(Number(after?.current || 0) * 1000 * 10) / 10, 'кг (ожид. 48800)');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
