/** Привязка benza_fuel_pending → fuel_entries при появлении ТС. */

import {
  benzaEventKey,
  buildPlateIndex,
  normalizePlate,
  type MixerPlate,
} from '@/lib/benzaFuelReport';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export type LinkPendingResult = {
  linked: number;
  errors: string[];
};

/**
 * Переносит несвязанные pending в fuel_entries для совпавших госномеров.
 * Если передан plateNormFilter — только этот номер; иначе все pending.
 */
export async function linkBenzaPendingToMixers(opts?: {
  mixers?: MixerPlate[];
  plateNormFilter?: string;
}): Promise<LinkPendingResult> {
  let mixers = opts?.mixers;
  if (!mixers) {
    const { data, error } = await supabaseAdmin
      .from('mixers')
      .select('id, number');
    if (error) throw new Error(error.message);
    mixers = (data ?? []) as MixerPlate[];
  }

  const { index: plateIndex } = buildPlateIndex(mixers);
  let query = supabaseAdmin
    .from('benza_fuel_pending')
    .select('id, plate_raw, plate_norm, filled_at, liters, benza_event_key')
    .is('linked_entry_id', null)
    .limit(5000);

  if (opts?.plateNormFilter) {
    query = query.eq('plate_norm', opts.plateNormFilter);
  }

  const { data: pending, error: pErr } = await query;
  if (pErr) {
    if (/benza_fuel_pending|does not exist|relation/i.test(pErr.message)) {
      return { linked: 0, errors: ['Выполни scripts/fleet-fuel-benza.sql'] };
    }
    throw new Error(pErr.message);
  }

  let linked = 0;
  const errors: string[] = [];

  for (const row of pending ?? []) {
    const mixerId = plateIndex.get(String(row.plate_norm));
    if (mixerId == null) continue;

    const key =
      String(row.benza_event_key) ||
      benzaEventKey(
        String(row.plate_norm),
        String(row.filled_at),
        Number(row.liters),
      );

    const { data: existing } = await supabaseAdmin
      .from('fuel_entries')
      .select('id')
      .eq('benza_event_key', key)
      .maybeSingle();

    let entryId = existing?.id as number | undefined;

    if (!entryId) {
      const { data: inserted, error: insErr } = await supabaseAdmin
        .from('fuel_entries')
        .insert({
          mixer_id: mixerId,
          filled_at: row.filled_at,
          liters: Number(row.liters),
          amount_rub: null,
          odometer_km: null,
          fuel_type: 'diesel',
          receipt_path: null,
          created_by: 'Benza',
          source: 'benza',
          benza_event_key: key,
        })
        .select('id')
        .single();

      if (insErr) {
        if (/benza_event_key|source|column/i.test(insErr.message)) {
          errors.push('Выполни scripts/fleet-fuel-benza.sql');
          break;
        }
        // unique race — найти снова
        const { data: again } = await supabaseAdmin
          .from('fuel_entries')
          .select('id')
          .eq('benza_event_key', key)
          .maybeSingle();
        entryId = again?.id as number | undefined;
        if (!entryId) {
          errors.push(`${row.plate_raw}: ${insErr.message}`);
          continue;
        }
      } else {
        entryId = inserted?.id as number;
      }
    }

    if (!entryId) continue;

    const { error: upErr } = await supabaseAdmin
      .from('benza_fuel_pending')
      .update({ linked_entry_id: entryId })
      .eq('id', row.id);

    if (upErr) {
      errors.push(`pending #${row.id}: ${upErr.message}`);
      continue;
    }
    linked += 1;
  }

  return { linked, errors };
}

/** Вызвать после create/update номера ТС. */
export async function linkBenzaPendingForMixerNumber(
  mixerId: number,
  number: string,
): Promise<LinkPendingResult> {
  const plateNorm = normalizePlate(number);
  if (!plateNorm) return { linked: 0, errors: [] };
  return linkBenzaPendingToMixers({
    mixers: [{ id: mixerId, number }],
    plateNormFilter: plateNorm,
  });
}
