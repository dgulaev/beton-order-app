/**
 * Разовый бэкфилл заправок/сливов из СКАУТ для всех ТС со scout_unit_id.
 * Usage: npx tsx scripts/backfill-scout-fuel.mts [fromYYYY-MM-DD] [toYYYY-MM-DD]
 */
import { createClient } from '@supabase/supabase-js';
import {
  scoutFetchFuelingStats,
  scoutFuelEventKey,
} from '../lib/integrations/scout/fuel';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

function moscowYmd(d = new Date()): string {
  return d.toLocaleDateString('en-CA', { timeZone: 'Europe/Moscow' });
}

const to = process.argv[3] || moscowYmd();
const from =
  process.argv[2] ||
  (() => {
    const [y, m] = to.split('-').map(Number);
    // с 1-го числа прошлого месяца (≈ 30–60 дней)
    const prev = m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, '0')}-01`;
    return prev;
  })();

console.log(`Бэкфилл СКАУТ топливо: ${from} → ${to}`);

const { data: mixers, error } = await supabase
  .from('mixers')
  .select('id, number, scout_unit_id')
  .not('scout_unit_id', 'is', null)
  .eq('type', 'own')
  .order('number');

if (error) {
  console.error(error.message);
  process.exit(1);
}

const fromIso = `${from}T00:00:00+03:00`;
const toIso = `${to}T23:59:59.999+03:00`;

let totalFueling = 0;
let totalDrain = 0;
let totalSkipped = 0;

for (const m of mixers || []) {
  const unitId = Number(m.scout_unit_id);
  process.stdout.write(`\n${m.number} (unit ${unitId}) … `);
  try {
    const stats = await scoutFetchFuelingStats({ unitId, fromIso, toIso });
    let fueling = 0;
    let drain = 0;
    let skipped = 0;

    for (const ev of stats.events) {
      const isFueling = ev.eventType === 'Fueling';
      const isDrain = ev.eventType === 'Defueling';
      if (!isFueling && !isDrain) {
        skipped += 1;
        continue;
      }
      const litersAbs =
        ev.deltaLiters == null ? null : Math.round(Math.abs(ev.deltaLiters) * 10) / 10;
      if (litersAbs == null || !(litersAbs > 0.05)) {
        skipped += 1;
        continue;
      }
      const key = scoutFuelEventKey(unitId, ev);
      const { data: existing } = await supabase
        .from('fuel_entries')
        .select('id')
        .eq('scout_event_key', key)
        .maybeSingle();
      if (existing) {
        skipped += 1;
        continue;
      }
      const { error: insErr } = await supabase.from('fuel_entries').insert({
        mixer_id: m.id,
        filled_at: ev.timestamp,
        liters: litersAbs,
        amount_rub: null,
        odometer_km: null,
        fuel_type: isDrain ? 'drain' : 'diesel',
        receipt_path: null,
        created_by: isDrain ? 'СКАУТ · слив' : 'СКАУТ',
        source: 'scout',
        scout_event_key: key,
      });
      if (insErr) {
        console.error(`\n  insert error: ${insErr.message}`);
        skipped += 1;
        continue;
      }
      if (isDrain) drain += 1;
      else fueling += 1;
    }

    totalFueling += fueling;
    totalDrain += drain;
    totalSkipped += skipped;
    console.log(
      `events=${stats.events.length} +${fueling} запр / +${drain} слив / skip ${skipped}` +
        (stats.totalFuelConsumptionL != null
          ? ` · расход ${stats.totalFuelConsumptionL.toFixed(1)} л`
          : ''),
    );
  } catch (e) {
    console.log('ERR', e instanceof Error ? e.message : e);
  }
}

console.log(
  `\nИтого: заправок ${totalFueling}, сливов ${totalDrain}, пропущено ${totalSkipped}`,
);
