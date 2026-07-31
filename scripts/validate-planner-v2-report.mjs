/**
 * Отчёт план/факт V2 без таблиц метрик (прямой матч по данным дня).
 * Usage: node scripts/validate-planner-v2-report.mjs [YYYY-MM-DD ...]
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

function todayMsk() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function addDaysYmd(ymd, days) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  dt.setDate(dt.getDate() + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function r1(n) {
  if (n == null || !Number.isFinite(n)) return null;
  return Math.round(n * 10) / 10;
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
  return (tb - ta) / 60000;
}

function moscowDayBounds(dateKey) {
  const start = new Date(`${dateKey}T00:00:00+03:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

async function reportDay(dateKey) {
  const planSel = await sb
    .from('daily_logistics_plans')
    .select('payload, morning_payload')
    .eq('delivery_date', dateKey)
    .maybeSingle();
  let planRow = planSel.data;
  let snapQuality = 'morning';
  if (planSel.error && /morning_/i.test(planSel.error.message || '')) {
    const retry = await sb
      .from('daily_logistics_plans')
      .select('payload')
      .eq('delivery_date', dateKey)
      .maybeSingle();
    planRow = retry.data;
    snapQuality = 'late';
  } else if (planSel.error) {
    throw new Error(planSel.error.message);
  }

  const morningTrips = planRow?.morning_payload?.trips;
  const lateTrips = planRow?.payload?.trips;
  const trips =
    Array.isArray(morningTrips) && morningTrips.length
      ? morningTrips
      : Array.isArray(lateTrips)
        ? lateTrips
        : [];
  if (!Array.isArray(morningTrips) || !morningTrips.length) snapQuality = 'late';

  const { data: orders, error: oErr } = await sb
    .from('orders')
    .select('id')
    .eq('delivery_date', dateKey)
    .neq('status', 'cancelled');
  if (oErr) throw new Error(oErr.message);
  const orderIds = (orders || []).map((o) => o.id);

  let mixers = [];
  for (let i = 0; i < orderIds.length; i += 150) {
    const slice = orderIds.slice(i, i + 150);
    const { data, error } = await sb
      .from('order_mixers')
      .select(
        'id, order_id, mixer_name, volume, status, time, loading_started_at, on_site_at, unloaded_at',
      )
      .in('order_id', slice);
    if (error) throw new Error(error.message);
    mixers = mixers.concat(data || []);
  }

  const { start, end } = moscowDayBounds(dateKey);
  const { data: logs, error: lErr } = await sb
    .from('production_logs')
    .select('id, order_mixer_id, start_time, end_time')
    .gte('start_time', start)
    .lt('start_time', end);
  if (lErr) throw new Error(lErr.message);
  const logByMixer = new Map();
  for (const l of logs || []) {
    if (l.order_mixer_id != null) logByMixer.set(String(l.order_mixer_id), l);
  }

  // простой fuzzy: order_id + ближайший time к plan load
  const byOrder = new Map();
  for (const m of mixers) {
    const k = String(m.order_id);
    const list = byOrder.get(k) || [];
    list.push(m);
    byOrder.set(k, list);
  }

  const loadFact = [];
  const loadPlan = [];
  const deltaStart = [];
  const cycleDelta = [];
  let matched = 0;

  for (const t of trips) {
    if (t.pickup) continue;
    const cand = byOrder.get(String(t.orderId)) || [];
    if (!cand.length) continue;
    const planLoad = parseHhMm(t.loadTime);
    let best = null;
    let bestScore = Infinity;
    for (const c of cand) {
      const factMin = parseHhMm(c.time);
      const score =
        planLoad != null && factMin != null
          ? Math.abs(factMin - planLoad)
          : 999;
      if (score < bestScore) {
        bestScore = score;
        best = c;
      }
    }
    if (!best || bestScore > 90) continue;
    matched += 1;
    const log = logByMixer.get(String(best.id));
    const loadStart = log?.start_time || best.loading_started_at || null;
    const release = log?.end_time || null;
    const dur = minutesBetween(loadStart, release);
    if (dur != null && dur > 0 && dur < 60) loadFact.push(dur);
    const planLoadMin = Number(t.loadMin);
    if (Number.isFinite(planLoadMin) && planLoadMin > 0) loadPlan.push(planLoadMin);

    if (planLoad != null && loadStart) {
      const d = new Date(loadStart);
      // МСК offset
      const factMin =
        ((d.getUTCHours() + 3) % 24) * 60 + d.getUTCMinutes() + Math.floor(d.getUTCDate() !== new Date(`${dateKey}T12:00:00Z`).getUTCDate() ? 0 : 0);
      // проще: локальные часы из ISO с +03
      const m = String(loadStart).match(/T(\d{2}):(\d{2})/);
      if (m) {
        const fm = Number(m[1]) * 60 + Number(m[2]);
        deltaStart.push(fm - planLoad);
      }
    }

    const planCycle =
      (Number(t.loadMin) || 0) +
      2 * (Number(t.roadMin) || 0) +
      (Number(t.unloadMin) || 0);
    const factCycle = minutesBetween(loadStart, best.unloaded_at);
    if (factCycle != null && planCycle > 0) cycleDelta.push(factCycle - planCycle);
  }

  const medLoadFact = median(loadFact);
  const medLoadPlan = median(loadPlan);
  const inflatedLoadMin =
    medLoadFact != null && medLoadPlan != null && medLoadPlan > medLoadFact
      ? r1(medLoadPlan - medLoadFact)
      : 0;

  return {
    date: dateKey,
    planTrips: trips.length,
    matched,
    snapQuality,
    medianLoadFact: r1(medLoadFact),
    medianLoadPlan: r1(medLoadPlan),
    earlyStartPct:
      deltaStart.length > 0
        ? Math.round((100 * deltaStart.filter((d) => d < -5).length) / deltaStart.length)
        : null,
    lateStartPct:
      deltaStart.length > 0
        ? Math.round((100 * deltaStart.filter((d) => d > 5).length) / deltaStart.length)
        : null,
    medianDeltaStart: r1(median(deltaStart)),
    medianCycleDelta: r1(median(cycleDelta)),
    loadInflationMin: inflatedLoadMin,
    suggestedLoadClamp: medLoadFact != null ? Math.max(8, Math.min(18, Math.round(medLoadFact))) : null,
  };
}

const args = process.argv.slice(2);
const today = todayMsk();
const dates =
  args.length > 0
    ? args
    : [today, addDaysYmd(today, -1), addDaysYmd(today, -2), addDaysYmd(today, -3)];

console.log('=== V2 plan/fact validate (live match) ===');
const rows = [];
for (const d of dates) {
  try {
    const r = await reportDay(d);
    rows.push(r);
    console.log(JSON.stringify(r));
  } catch (e) {
    console.log(JSON.stringify({ date: d, error: e.message }));
  }
}

const withLoad = rows.filter((r) => r.medianLoadFact != null);
if (withLoad.length) {
  const avgFact = median(withLoad.map((r) => r.medianLoadFact));
  const avgPlan = median(withLoad.map((r) => r.medianLoadPlan).filter((n) => n != null));
  console.log('=== summary ===');
  console.log(
    JSON.stringify({
      days: withLoad.length,
      medianLoadFactAcrossDays: r1(avgFact),
      medianLoadPlanAcrossDays: r1(avgPlan),
      recommendation:
        avgFact != null && avgPlan != null && avgFact + 1 < avgPlan
          ? `Факт соски ~${r1(avgFact)} мин vs план ~${r1(avgPlan)} — clamp 8…18 корректен, калибровка должна подтянуть loadP50 вниз`
          : 'Систематического завышения соски не видно / мало данных',
    }),
  );
}
