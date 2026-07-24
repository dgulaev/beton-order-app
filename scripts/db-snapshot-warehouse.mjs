/**
 * Снимок критичных таблиц склада / MEKA / сегментов цемента.
 * Точка восстановления на случай отката после полевого теста.
 *
 * Usage:
 *   node --env-file=.env.local scripts/db-snapshot-warehouse.mjs
 *   node --env-file=.env.local scripts/db-snapshot-warehouse.mjs --restore backups/warehouse-YYYY-MM-DD_HHMM.json
 *   node --env-file=.env.local scripts/db-snapshot-warehouse.mjs --restore ... --dry-run
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Нужны SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const sb = createClient(url, key, { auth: { persistSession: false } });

/** Полные таблицы — восстанавливаем целиком (upsert по id / ключу). */
const FULL_TABLES = [
  { table: 'warehouse_silos', pk: 'silo_id' },
  { table: 'warehouse_additives', pk: 'additive_id' },
  { table: 'warehouse_cement_savings', pk: 'id' },
  { table: 'warehouse_meka_cement_compensations', pk: 'id' },
  { table: 'order_mixer_cement_segments', pk: 'id' },
  { table: 'meka_reports', pk: 'id' },
  { table: 'operator_shift_settings', pk: 'id' },
];

/** История операций — может быть большой; берём целиком с пагинацией. */
const OPS_TABLE = { table: 'warehouse_operations', pk: 'id' };

/** Колонки рейсов, связанные со списанием цемента (не весь заказ). */
const MIXER_CEMENT_COLS =
  'id, order_id, status, volume, cement_write_off_kg, cement_write_off_silo_id, cement_write_off_at, updated_at, created_at';

async function fetchAll(table, select = '*', orderCol = 'id') {
  const pageSize = 1000;
  const rows = [];
  let from = 0;
  for (;;) {
    const { data, error } = await sb
      .from(table)
      .select(select)
      .order(orderCol, { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

async function snapshot() {
  const stamp = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const label = `${stamp.getFullYear()}-${pad(stamp.getMonth() + 1)}-${pad(stamp.getDate())}_${pad(stamp.getHours())}${pad(stamp.getMinutes())}`;

  const payload = {
    meta: {
      created_at: stamp.toISOString(),
      created_at_msk: stamp.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }),
      label,
      purpose: 'Точка восстановления перед полевым тестом split силосов / компенсации MEKA',
      note: 'Откат: node --env-file=.env.local scripts/db-snapshot-warehouse.mjs --restore <файл>',
    },
    tables: {},
  };

  for (const { table } of FULL_TABLES) {
    process.stdout.write(`  ${table}... `);
    const rows = await fetchAll(table);
    payload.tables[table] = rows;
    console.log(`${rows.length} строк`);
  }

  process.stdout.write(`  ${OPS_TABLE.table}... `);
  const ops = await fetchAll(OPS_TABLE.table);
  payload.tables[OPS_TABLE.table] = ops;
  console.log(`${ops.length} строк`);

  process.stdout.write('  order_mixers (cement cols)... ');
  const mixers = await fetchAll('order_mixers', MIXER_CEMENT_COLS);
  payload.tables.order_mixers_cement = mixers;
  console.log(`${mixers.length} строк`);

  const dir = path.join(process.cwd(), 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `warehouse-${label}.json`);
  fs.writeFileSync(file, JSON.stringify(payload, null, 2), 'utf8');

  const latest = path.join(dir, 'warehouse-LATEST.json');
  fs.writeFileSync(latest, JSON.stringify(payload, null, 2), 'utf8');

  const mb = (fs.statSync(file).size / (1024 * 1024)).toFixed(2);
  console.log(`\nСнимок сохранён:`);
  console.log(`  ${file}`);
  console.log(`  ${latest} (копия)`);
  console.log(`  размер: ${mb} MB`);
  console.log(`\nОткат при необходимости:`);
  console.log(`  node --env-file=.env.local scripts/db-snapshot-warehouse.mjs --restore ${file}`);
}

async function upsertChunk(table, rows, onConflict) {
  const chunk = 200;
  for (let i = 0; i < rows.length; i += chunk) {
    const part = rows.slice(i, i + chunk);
    const { error } = await sb.from(table).upsert(part, { onConflict });
    if (error) throw new Error(`${table} upsert: ${error.message}`);
  }
}

async function restore(filePath, dryRun) {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) {
    console.error('Файл не найден:', abs);
    process.exit(1);
  }
  const payload = JSON.parse(fs.readFileSync(abs, 'utf8'));
  console.log('Снимок:', payload.meta?.created_at_msk || payload.meta?.created_at);
  console.log('Назначение:', payload.meta?.purpose || '—');
  if (dryRun) {
    for (const [t, rows] of Object.entries(payload.tables || {})) {
      console.log(`  [dry-run] ${t}: ${(rows || []).length} строк`);
    }
    console.log('\nDry-run — в БД ничего не писали.');
    return;
  }

  console.log('\n⚠ Восстановление: силосы/добавки upsert;');
  console.log('  сегменты / компенсация / экономия — полная замена по снимку;');
  console.log('  операции склада — upsert + удаление строк новее снимка.\n');

  // 1) Остатки
  for (const [table, pk] of [
    ['warehouse_silos', 'silo_id'],
    ['warehouse_additives', 'additive_id'],
    ['operator_shift_settings', 'id'],
    ['meka_reports', 'id'],
  ]) {
    const rows = payload.tables?.[table];
    if (!rows) {
      console.log(`  ${table}: нет в снимке, пропуск`);
      continue;
    }
    process.stdout.write(`  ${table} (${rows.length}) upsert... `);
    await upsertChunk(table, rows, pk);
    console.log('ok');
  }

  // 2) Полная замена «тонких» таблиц теста
  for (const table of [
    'order_mixer_cement_segments',
    'warehouse_meka_cement_compensations',
    'warehouse_cement_savings',
  ]) {
    const rows = payload.tables?.[table];
    if (!rows) {
      console.log(`  ${table}: нет в снимке, пропуск`);
      continue;
    }
    process.stdout.write(`  ${table}: wipe + insert (${rows.length})... `);
    const { error: delErr } = await sb.from(table).delete().neq('id', 0);
    if (delErr) throw new Error(`${table} wipe: ${delErr.message}`);
    if (rows.length) await upsertChunk(table, rows, 'id');
    console.log('ok');
  }

  // 3) История операций: upsert + убрать всё новее снимка
  {
    const rows = payload.tables?.warehouse_operations || [];
    const cut = payload.meta?.created_at;
    process.stdout.write(`  warehouse_operations (${rows.length}) upsert... `);
    if (rows.length) await upsertChunk(rows, 'id');
    console.log('ok');
    if (cut) {
      process.stdout.write(`  warehouse_operations: delete created_at > ${cut}... `);
      const { error } = await sb.from('warehouse_operations').delete().gt('created_at', cut);
      if (error) throw new Error(`warehouse_operations trim: ${error.message}`);
      console.log('ok');
    }
  }

  const mixers = payload.tables?.order_mixers_cement;
  if (mixers?.length) {
    process.stdout.write(`  order_mixers cement (${mixers.length})... `);
    // обновляем только cement-поля по id
    const chunk = 100;
    for (let i = 0; i < mixers.length; i += chunk) {
      const part = mixers.slice(i, i + chunk);
      for (const m of part) {
        const { id, ...rest } = m;
        const patch = {
          cement_write_off_kg: rest.cement_write_off_kg,
          cement_write_off_silo_id: rest.cement_write_off_silo_id,
          cement_write_off_at: rest.cement_write_off_at,
        };
        const { error } = await sb.from('order_mixers').update(patch).eq('id', id);
        if (error) throw new Error(`order_mixers ${id}: ${error.message}`);
      }
    }
    console.log('ok');
  }

  console.log('\nГотово. Проверь силосы и сверку MEKA в админке.');
}

const args = process.argv.slice(2);
const restoreIdx = args.indexOf('--restore');
const dryRun = args.includes('--dry-run');

if (restoreIdx >= 0) {
  const file = args[restoreIdx + 1];
  if (!file) {
    console.error('Укажи путь к файлу после --restore');
    process.exit(1);
  }
  await restore(file, dryRun);
} else {
  console.log('Создаю снимок склада / MEKA / сегментов...\n');
  await snapshot();
}
