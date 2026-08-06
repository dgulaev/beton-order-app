import { NextRequest, NextResponse } from 'next/server';
import { FLEET_MUTATION_ROLES, requireAdminCifraStaff } from '@/lib/adminCifraAuth';
import {
  benzaEventKey,
  buildPlateIndex,
  parseBenzaFuelWorkbook,
} from '@/lib/benzaFuelReport';
import { linkBenzaPendingToMixers } from '@/lib/benzaFuelLink';
import { fleetTableMissingMessage } from '@/lib/fleetDocumentsServer';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

const INSERT_CHUNK = 80;
const KEY_CHUNK = 80;

async function existingKeys(keys: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  if (!keys.length) return found;
  for (let i = 0; i < keys.length; i += KEY_CHUNK) {
    const chunk = keys.slice(i, i + KEY_CHUNK);
    const { data, error } = await supabaseAdmin
      .from('fuel_entries')
      .select('benza_event_key')
      .in('benza_event_key', chunk);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      if (row.benza_event_key) found.add(String(row.benza_event_key));
    }
  }
  return found;
}

async function existingPendingKeys(keys: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  if (!keys.length) return found;
  for (let i = 0; i < keys.length; i += KEY_CHUNK) {
    const chunk = keys.slice(i, i + KEY_CHUNK);
    const { data, error } = await supabaseAdmin
      .from('benza_fuel_pending')
      .select('benza_event_key')
      .in('benza_event_key', chunk);
    if (error) {
      if (/benza_fuel_pending|does not exist|relation/i.test(error.message)) {
        throw new Error('SCHEMA:benza_fuel_pending');
      }
      throw new Error(error.message);
    }
    for (const row of data ?? []) {
      if (row.benza_event_key) found.add(String(row.benza_event_key));
    }
  }
  return found;
}

/** POST multipart: file=xlsx — импорт отпуска Benza. */
export async function POST(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request, FLEET_MUTATION_ROLES);
  if (auth.error) return auth.error;

  try {
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json(
        { success: false, error: 'Прикрепи файл Excel (.xlsx)' },
        { status: 400 },
      );
    }

    const name = (file.name || '').toLowerCase();
    if (name.endsWith('.xls') && !name.endsWith('.xlsx')) {
      return NextResponse.json(
        {
          success: false,
          error: 'Нужен файл .xlsx (старый .xls не поддерживается). Выгрузи отчёт Benza в Excel 2007+.',
        },
        { status: 400 },
      );
    }
    if (!name.endsWith('.xlsx')) {
      return NextResponse.json(
        { success: false, error: 'Нужен файл .xlsx отчёта Benza' },
        { status: 400 },
      );
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const parsed = await parseBenzaFuelWorkbook(buf);
    if (!parsed.rows.length) {
      return NextResponse.json({
        success: true,
        imported: 0,
        pending: 0,
        duplicates: 0,
        failed: 0,
        linkedFromPending: 0,
        unmatchedPlates: [],
        duplicateMixerPlates: [],
        errors: [] as string[],
        periodLabel: parsed.periodLabel,
        skippedZero: parsed.skippedZero,
        hint: 'В файле не найдено строк отпуска. Проверь формат отчёта Benza.',
      });
    }

    const { data: mixers, error: mErr } = await supabaseAdmin
      .from('mixers')
      .select('id, number');
    if (mErr) throw new Error(mErr.message);

    const { index: plateIndex, duplicatePlates } = buildPlateIndex(mixers ?? []);
    const batch = `benza-${Date.now()}`;

    const keyed = parsed.rows.map((row) => ({
      ...row,
      key: benzaEventKey(row.plateNorm, row.atIso, row.liters),
    }));

    const allKeys = keyed.map((r) => r.key);
    let existFuel: Set<string>;
    let existPending: Set<string>;
    try {
      [existFuel, existPending] = await Promise.all([
        existingKeys(allKeys),
        existingPendingKeys(allKeys),
      ]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === 'SCHEMA:benza_fuel_pending' || /benza_event_key|column/i.test(msg)) {
        return NextResponse.json({
          success: false,
          imported: 0,
          pending: 0,
          duplicates: 0,
          failed: 0,
          linkedFromPending: 0,
          unmatchedPlates: [],
          duplicateMixerPlates: duplicatePlates,
          errors: ['Выполни scripts/fleet-fuel-benza.sql в Supabase'],
          error: 'Выполни scripts/fleet-fuel-benza.sql в Supabase',
          hint: 'Выполни scripts/fleet-fuel-benza.sql в Supabase',
        });
      }
      throw e;
    }

    type FuelInsert = {
      mixer_id: number;
      filled_at: string;
      liters: number;
      amount_rub: null;
      odometer_km: null;
      fuel_type: string;
      receipt_path: null;
      created_by: string;
      source: string;
      benza_event_key: string;
    };
    type PendingInsert = {
      plate_raw: string;
      plate_norm: string;
      filled_at: string;
      liters: number;
      benza_event_key: string;
      import_batch: string;
    };

    const fuelInserts: FuelInsert[] = [];
    const pendingInserts: PendingInsert[] = [];
    let duplicates = 0;
    const unmatchedSet = new Set<string>();
    const errors: string[] = [];

    for (const row of keyed) {
      if (existFuel.has(row.key) || existPending.has(row.key)) {
        duplicates += 1;
        continue;
      }
      const mixerId = plateIndex.get(row.plateNorm) ?? null;
      if (mixerId != null) {
        fuelInserts.push({
          mixer_id: mixerId,
          filled_at: row.atIso,
          liters: row.liters,
          amount_rub: null,
          odometer_km: null,
          fuel_type: 'diesel',
          receipt_path: null,
          created_by: 'Benza',
          source: 'benza',
          benza_event_key: row.key,
        });
      } else {
        unmatchedSet.add(row.plateRaw);
        pendingInserts.push({
          plate_raw: row.plateRaw,
          plate_norm: row.plateNorm,
          filled_at: row.atIso,
          liters: row.liters,
          benza_event_key: row.key,
          import_batch: batch,
        });
      }
    }

    let imported = 0;
    let pending = 0;
    let failed = 0;

    for (let i = 0; i < fuelInserts.length; i += INSERT_CHUNK) {
      const chunk = fuelInserts.slice(i, i + INSERT_CHUNK);
      const { data, error } = await supabaseAdmin
        .from('fuel_entries')
        .insert(chunk)
        .select('id');
      if (error) {
        if (/benza_event_key|source|column/i.test(error.message)) {
          errors.push('Выполни scripts/fleet-fuel-benza.sql в Supabase');
          failed += chunk.length;
          break;
        }
        if (/duplicate|unique/i.test(error.message)) {
          // чанк частично дубли — вставим по одному
          for (const row of chunk) {
            const { error: oneErr } = await supabaseAdmin.from('fuel_entries').insert(row);
            if (oneErr) {
              if (/duplicate|unique/i.test(oneErr.message)) duplicates += 1;
              else {
                failed += 1;
                if (errors.length < 15) errors.push(oneErr.message);
              }
            } else {
              imported += 1;
            }
          }
          continue;
        }
        failed += chunk.length;
        if (errors.length < 15) errors.push(error.message);
        continue;
      }
      imported += data?.length ?? chunk.length;
    }

    for (let i = 0; i < pendingInserts.length; i += INSERT_CHUNK) {
      const chunk = pendingInserts.slice(i, i + INSERT_CHUNK);
      const { data, error } = await supabaseAdmin
        .from('benza_fuel_pending')
        .insert(chunk)
        .select('id');
      if (error) {
        if (/benza_fuel_pending|does not exist|relation|column/i.test(error.message)) {
          errors.push(
            'Выполни scripts/fleet-fuel-benza.sql в Supabase (таблица benza_fuel_pending)',
          );
          failed += chunk.length;
          break;
        }
        if (/duplicate|unique/i.test(error.message)) {
          for (const row of chunk) {
            const { error: oneErr } = await supabaseAdmin
              .from('benza_fuel_pending')
              .insert(row);
            if (oneErr) {
              if (/duplicate|unique/i.test(oneErr.message)) duplicates += 1;
              else {
                failed += 1;
                if (errors.length < 15) errors.push(oneErr.message);
              }
            } else {
              pending += 1;
            }
          }
          continue;
        }
        failed += chunk.length;
        if (errors.length < 15) errors.push(error.message);
        continue;
      }
      pending += data?.length ?? chunk.length;
    }

    // Старые pending → история (отдельно от imported текущего файла)
    const link = errors.some((e) => /fleet-fuel-benza/i.test(e))
      ? { linked: 0, errors: [] as string[] }
      : await linkBenzaPendingToMixers({ mixers: mixers ?? [] });

    if (link.errors.length) {
      for (const e of link.errors.slice(0, 5)) {
        if (errors.length < 20) errors.push(e);
      }
    }

    const schemaFail = errors.some((e) => /fleet-fuel-benza/i.test(e));
    const hints: string[] = [];
    if (duplicatePlates.length) {
      hints.push(
        `В справочнике дубли госномеров (нормализ.): ${duplicatePlates.slice(0, 8).join(', ')} — заправка уйдёт на последнее ТС`,
      );
    }
    if (link.linked > 0) {
      hints.push(`Дополнительно привязано из ожидающих: ${link.linked}`);
    }
    if (failed > 0) {
      hints.push(`Не записано строк: ${failed}`);
    }
    hints.push('Benza без цены в отчёте не входит в «Стоимость владения» (₽) — только литры в истории.');

    return NextResponse.json({
      success: !schemaFail && failed === 0,
      imported,
      pending,
      duplicates,
      failed,
      linkedFromPending: link.linked,
      unmatchedPlates: [...unmatchedSet].sort((a, b) => a.localeCompare(b, 'ru')),
      duplicateMixerPlates: duplicatePlates,
      errors,
      periodLabel: parsed.periodLabel,
      skippedZero: parsed.skippedZero,
      error: schemaFail ? errors[0] : failed > 0 ? `Ошибки записи: ${failed}` : null,
      hint: hints.join(' '),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Ошибка импорта';
    return NextResponse.json(
      {
        success: false,
        error: /fuel_entries|benza/i.test(msg)
          ? fleetTableMissingMessage(msg, 'fuel_entries')
          : msg,
      },
      { status: 500 },
    );
  }
}
