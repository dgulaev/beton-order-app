/**
 * Разовый ремонт 24.07.2026:
 * 1) Рейс #659 / mixer 1092: разнести цемент 6.5 м³ → силос 1, 4 м³ → силос 2
 * 2) Дописать пропущенную экономию при обнулении силоса 1 (−4318 кг)
 * 3) Запустить компенсацию MEKA за день (отчёт уже загружен до хука)
 *
 * Запуск: node scripts/repair-trip-1092-and-savings.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

function loadEnv() {
  const raw = fs.readFileSync(path.join(root, '.env.local'), 'utf8');
  const env = {};
  for (const line of raw.split('\n')) {
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const i = line.indexOf('=');
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    env[line.slice(0, i).trim()] = v;
  }
  return env;
}

const env = loadEnv();
const sb = createClient(
  env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
);

const MIXER_ID = 1092;
const ORDER_ID = 659;
const SILO1_M3 = 6.5;
const SILO2_M3 = 4;
const CEMENT_PER_M3 = 350; // М350
const SILO1_KG = Math.round(SILO1_M3 * CEMENT_PER_M3 * 10) / 10; // 2275
const SILO2_KG = Math.round(SILO2_M3 * CEMENT_PER_M3 * 10) / 10; // 1400
const TOTAL_KG = Math.round((SILO1_KG + SILO2_KG) * 10) / 10; // 3675

async function repairTripSplit() {
  const { data: mixer, error } = await sb
    .from('order_mixers')
    .select('id, order_id, volume, cement_write_off_kg, cement_write_off_silo_id, cement_write_off_at')
    .eq('id', MIXER_ID)
    .maybeSingle();
  if (error || !mixer) throw new Error(`Рейс ${MIXER_ID}: ${error?.message || 'не найден'}`);

  const { data: existingSegs } = await sb
    .from('order_mixer_cement_segments')
    .select('id')
    .eq('order_mixer_id', MIXER_ID);
  if (existingSegs && existingSegs.length > 0) {
    console.log('skip split: сегменты уже есть', existingSegs.length);
    return { skipped: true };
  }

  const currentKg = Math.round(Number(mixer.cement_write_off_kg || 0) * 10) / 10;
  const currentSilo = Number(mixer.cement_write_off_silo_id);
  if (currentKg !== TOTAL_KG || currentSilo !== 1) {
    throw new Error(
      `Неожиданное состояние рейса: kg=${currentKg} silo=${currentSilo}, ждали ${TOTAL_KG}/1`,
    );
  }

  // Было всё с силоса 1 → вернуть долю силоса 2 на силос 1, списать с силоса 2
  const moveTons = SILO2_KG / 1000;
  const { data: addRows, error: addErr } = await sb.rpc('warehouse_silo_adjust', {
    p_silo_id: 1,
    p_delta_tons: moveTons,
  });
  if (addErr) throw new Error(`Возврат на силос 1: ${addErr.message}`);

  const { data: subRows, error: subErr } = await sb.rpc('warehouse_silo_adjust', {
    p_silo_id: 2,
    p_delta_tons: -moveTons,
  });
  if (subErr) {
    await sb.rpc('warehouse_silo_adjust', { p_silo_id: 1, p_delta_tons: -moveTons });
    throw new Error(`Списание с силоса 2: ${subErr.message}`);
  }

  const writeOffAt = mixer.cement_write_off_at || new Date().toISOString();
  const midAt = new Date(new Date(writeOffAt).getTime() - 60_000).toISOString();

  const { error: segErr } = await sb.from('order_mixer_cement_segments').insert([
    {
      order_mixer_id: MIXER_ID,
      silo_id: 2,
      volume_m3: SILO2_M3,
      cement_kg: SILO2_KG,
      kind: 'mid_load',
      created_at: midAt,
    },
    {
      order_mixer_id: MIXER_ID,
      silo_id: 1,
      volume_m3: SILO1_M3,
      cement_kg: SILO1_KG,
      kind: 'final',
      created_at: writeOffAt,
    },
  ]);
  if (segErr) {
    await sb.rpc('warehouse_silo_adjust', { p_silo_id: 1, p_delta_tons: -moveTons });
    await sb.rpc('warehouse_silo_adjust', { p_silo_id: 2, p_delta_tons: moveTons });
    throw new Error(`Сегменты: ${segErr.message}`);
  }

  await sb
    .from('order_mixers')
    .update({
      cement_write_off_silo_id: 1,
      cement_write_off_kg: TOTAL_KG,
      cement_write_off_at: writeOffAt,
    })
    .eq('id', MIXER_ID);

  const addAdj = Array.isArray(addRows) ? addRows[0] : addRows;
  const subAdj = Array.isArray(subRows) ? subRows[0] : subRows;
  await sb.from('warehouse_operations').insert([
    {
      operation_type: 'add',
      item_type: 'Силос 1',
      amount: SILO2_KG,
      old_value: Math.round(Number(addAdj?.old_current ?? 0) * 1000 * 10) / 10,
      new_value: Math.round(Number(addAdj?.new_current ?? 0) * 1000 * 10) / 10,
      unit: 'кг',
      user_name: `Корректировка сегментов · заявка #${ORDER_ID} · силос 2→доля возврат`,
    },
    {
      operation_type: 'subtract',
      item_type: 'Силос 2',
      amount: SILO2_KG,
      old_value: Math.round(Number(subAdj?.old_current ?? 0) * 1000 * 10) / 10,
      new_value: Math.round(Number(subAdj?.new_current ?? 0) * 1000 * 10) / 10,
      unit: 'кг',
      user_name: `Корректировка сегментов · заявка #${ORDER_ID} · 4 м³ с силоса 2`,
    },
  ]);

  console.log('split ok:', { SILO1_KG, SILO2_KG, TOTAL_KG });
  return { skipped: false };
}

async function backfillSavings() {
  const { count } = await sb
    .from('warehouse_cement_savings')
    .select('*', { count: 'exact', head: true });
  if ((count || 0) > 0) {
    // Уже есть хоть что-то — ищем конкретную запись утра
    const { data: existing } = await sb
      .from('warehouse_cement_savings')
      .select('id')
      .eq('silo_id', 1)
      .eq('reason', 'reset')
      .eq('amount_kg', 4318)
      .limit(1);
    if (existing?.length) {
      console.log('skip savings: уже есть 4318 кг');
      return;
    }
  }

  const { data: ins, error } = await sb
    .from('warehouse_cement_savings')
    .insert({
      silo_id: 1,
      amount_kg: 4318,
      reason: 'reset',
      balance_before_tons: -4.318,
      user_name: 'Максим',
      created_at: '2026-07-24T09:54:39.106626+00:00',
    })
    .select('id')
    .maybeSingle();
  if (error) throw new Error(`Экономия backfill: ${error.message}`);
  console.log('savings backfill ok id=', ins?.id);
}

async function main() {
  console.log('=== repair trip 1092 + savings ===');
  await repairTripSplit();
  await backfillSavings();
  console.log('done — компенсацию MEKA запусти: npx tsx scripts/run-meka-compensate-date.ts 2026-07-24');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
