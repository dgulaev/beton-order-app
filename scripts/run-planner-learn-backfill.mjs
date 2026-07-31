/**
 * Локальный backfill V2 без колонки no_operator_record (её нет в production_logs).
 * Usage: node scripts/run-planner-learn-backfill.mjs [days=45]
 *
 * Нужен, пока в проде learn ещё с багованным select.
 */
import fs from 'fs';
import { createClient } from '@supabase/supabase-js';
import { createRequire } from 'module';

// Подтягиваем скомпилированную логику нельзя — дублируем минимальный путь через
// динамический import TS не сработает. Зовум API? Нет auth.
// Поэтому: вызываем тот же код через next-like — проще скопировать fetch+upsert
// из отладочного пути.

const env = fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const get = (k) => {
  const m = env.match(new RegExp(`^${k}=(.*)$`, 'm'));
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : null;
};
const sb = createClient(
  get('NEXT_PUBLIC_SUPABASE_URL') || get('SUPABASE_URL'),
  get('SUPABASE_SERVICE_ROLE_KEY'),
);

const days = Math.min(90, Math.max(1, Number(process.argv[2]) || 45));

function addDaysYmd(ymd, d) {
  const [y, m, day] = ymd.split('-').map(Number);
  const dt = new Date(y, m - 1, day);
  dt.setDate(dt.getDate() + d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function moscowDayBounds(dateKey) {
  const start = new Date(`${dateKey}T00:00:00+03:00`);
  const end = new Date(start.getTime() + 86400000);
  return { start: start.toISOString(), end: end.toISOString() };
}

function parseHhMm(raw) {
  if (!raw) return null;
  const m = String(raw).match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function minutesBetween(a, b) {
  if (!a || !b) return null;
  const ta = new Date(a).getTime();
  const tb = new Date(b).getTime();
  if (Number.isNaN(ta) || Number.isNaN(tb)) return null;
  return Math.round(((tb - ta) / 60000) * 10) / 10;
}

function round1(n) {
  if (n == null || !Number.isFinite(n)) return null;
  return Math.round(n * 10) / 10;
}

async function learnDay(dateKey) {
  const { data: planRow, error: planErr } = await sb
    .from('daily_logistics_plans')
    .select('payload, morning_payload')
    .eq('delivery_date', dateKey)
    .maybeSingle();
  if (planErr) throw planErr;

  const morning = planRow?.morning_payload?.trips;
  const late = planRow?.payload?.trips;
  const trips =
    Array.isArray(morning) && morning.length
      ? morning
      : Array.isArray(late)
        ? late
        : [];
  const quality =
    Array.isArray(morning) && morning.length ? 'morning' : 'late';
  if (!trips.length) {
    return { date: dateKey, tripCount: 0, upserted: 0, matched: 0 };
  }

  const { data: orders, error: oErr } = await sb
    .from('orders')
    .select('id')
    .eq('delivery_date', dateKey)
    .neq('status', 'cancelled');
  if (oErr) throw oErr;
  const orderIds = (orders || []).map((o) => o.id);

  let dayTrips = [];
  for (let i = 0; i < orderIds.length; i += 150) {
    const slice = orderIds.slice(i, i + 150);
    const { data, error } = await sb
      .from('order_mixers')
      .select(
        'id, order_id, mixer_name, volume, status, time, loading_started_at, on_site_at, unloaded_at',
      )
      .in('order_id', slice);
    if (error) throw error;
    dayTrips = dayTrips.concat(data || []);
  }

  const { start, end } = moscowDayBounds(dateKey);
  const { data: logs, error: lErr } = await sb
    .from('production_logs')
    .select('id, order_id, order_mixer_id, start_time, end_time, mixer_name, volume')
    .gte('start_time', start)
    .lt('start_time', end);
  if (lErr) throw lErr;

  const logByMixer = new Map();
  for (const l of logs || []) {
    if (l.order_mixer_id != null) logByMixer.set(String(l.order_mixer_id), l);
  }

  const byOrder = new Map();
  for (const m of dayTrips) {
    const k = String(m.order_id);
    const list = byOrder.get(k) || [];
    list.push(m);
    byOrder.set(k, list);
  }

  const rows = [];
  const nowIso = new Date().toISOString();
  for (const t of trips) {
    if (t.pickup) continue;
    const cand = byOrder.get(String(t.orderId)) || [];
    let best = null;
    let bestScore = Infinity;
    const planLoad = parseHhMm(t.loadTime);
    for (const c of cand) {
      const factMin = parseHhMm(c.time);
      const score =
        planLoad != null && factMin != null ? Math.abs(factMin - planLoad) : 999;
      if (score < bestScore) {
        bestScore = score;
        best = c;
      }
    }
    const hasMatch = Boolean(best && bestScore <= 90);
    const log = hasMatch ? logByMixer.get(String(best.id)) : null;
    const loadStart = log?.start_time || best?.loading_started_at || null;
    const release = log?.end_time || null;
    const onSite = best?.on_site_at || null;
    const unloaded = best?.unloaded_at || null;
    const factLoadDur = minutesBetween(loadStart, release);
    const factRoad = minutesBetween(release, onSite);
    const factOnsite = minutesBetween(onSite, unloaded);
    const planCycle =
      (Number(t.loadMin) || 0) +
      2 * (Number(t.roadMin) || 0) +
      (Number(t.unloadMin) || 0);
    const factCycle = minutesBetween(loadStart, unloaded);
    rows.push({
      delivery_date: dateKey,
      plan_trip_id: String(t.id),
      order_id: Number.isFinite(Number(t.orderId)) ? Number(t.orderId) : null,
      order_mixer_id: hasMatch ? best.id : null,
      mixer_number: t.mixerNumber || null,
      volume_m3: Number.isFinite(Number(t.volume)) ? Number(t.volume) : null,
      plan_load_at: t.loadTime || null,
      plan_arrive_at: t.arriveTime || null,
      plan_load_min: round1(Number(t.loadMin) || null),
      plan_road_min: round1(Number(t.roadMin) || null),
      plan_unload_min: round1(Number(t.unloadMin) || null),
      fact_load_start: loadStart,
      fact_release_at: release,
      fact_on_site_at: onSite,
      fact_unloaded_at: unloaded,
      delta_load_start_min: null,
      fact_load_dur_min: round1(factLoadDur),
      fact_road_min: round1(factRoad),
      fact_onsite_min: round1(factOnsite),
      delta_cycle_min:
        factCycle != null && planCycle > 0 ? round1(factCycle - planCycle) : null,
      match_kind: hasMatch ? 'fuzzy' : 'none',
      no_operator: false,
      snapshot_quality: quality,
      computed_at: nowIso,
    });
  }

  for (let i = 0; i < rows.length; i += 80) {
    const chunk = rows.slice(i, i + 80);
    const { error } = await sb
      .from('plan_fact_trip_metrics')
      .upsert(chunk, { onConflict: 'delivery_date,plan_trip_id' });
    if (error) throw error;
  }

  return {
    date: dateKey,
    tripCount: trips.length,
    upserted: rows.length,
    matched: rows.filter((r) => r.match_kind !== 'none').length,
  };
}

const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Moscow',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());

const results = [];
for (let i = days - 1; i >= 0; i--) {
  const d = addDaysYmd(today, -i);
  try {
    const r = await learnDay(d);
    results.push(r);
    if (r.upserted > 0) console.log(JSON.stringify(r));
  } catch (e) {
    console.log(JSON.stringify({ date: d, error: e.message }));
    results.push({ date: d, error: e.message });
  }
}

const learned = results.filter((r) => r.upserted > 0);
console.log('=== done ===', {
  days,
  withMetrics: learned.length,
  totalUpserted: learned.reduce((s, r) => s + (r.upserted || 0), 0),
  errors: results.filter((r) => r.error).length,
});

// Простая калибровка load/unload P50 (полная — после деплоя фикса в API)
const from = addDaysYmd(today, -(days - 1));
const { data: mrows, error: mErr } = await sb
  .from('plan_fact_trip_metrics')
  .select('delivery_date, fact_load_dur_min, fact_onsite_min, match_kind')
  .gte('delivery_date', from)
  .lte('delivery_date', today)
  .neq('match_kind', 'none');
if (mErr) throw mErr;

function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

const loadAll = (mrows || [])
  .map((r) => Number(r.fact_load_dur_min))
  .filter((n) => n >= 4 && n <= 40);
const unloadAll = (mrows || [])
  .map((r) => Number(r.fact_onsite_min))
  .filter((n) => n >= 8 && n <= 90);
const loadP50 = median(loadAll);
const unloadP50 = median(unloadAll);
const daysUsed = new Set((mrows || []).map((r) => r.delivery_date)).size;
const updatedAt = new Date().toISOString();
const payload = {
  loadByBucket: {},
  loadP50: loadP50 != null ? clamp(loadP50, 8, 18) : null,
  unloadP50: unloadP50 != null ? clamp(unloadP50, 20, 45) : null,
  roadFactorOffpeak: null,
  roadFactorPeak: null,
  joinBufferP50: null,
  samples: loadAll.length,
  daysUsed,
  updatedAt,
  meta: {
    days: daysUsed,
    samples: loadAll.length,
    loadP50: loadP50 != null ? clamp(loadP50, 8, 18) : null,
    unloadP50: unloadP50 != null ? clamp(unloadP50, 20, 45) : null,
    active: loadAll.length >= 12,
  },
};

const { error: cErr } = await sb.from('planner_calibration_current').upsert(
  {
    id: 1,
    payload,
    samples: loadAll.length,
    days_used: daysUsed,
    updated_at: updatedAt,
  },
  { onConflict: 'id' },
);
if (cErr) throw cErr;
console.log('calibration', {
  samples: loadAll.length,
  daysUsed,
  loadP50: payload.loadP50,
  unloadP50: payload.unloadP50,
});
console.log('Проверь: node scripts/validate-planner-v2-day.mjs', today);
