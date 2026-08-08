/**
 * Локальные кроны для `next dev` / `next start` вне Vercel.
 *
 * На Vercel — vercel.json (часто урезано Hobby). Целевые интервалы всех jobs:
 *   scripts/cron-schedules.md + .cursor/plans/переход_на_mac_mini.plan.md Фаза 4.
 *
 * Здесь до cutover: GPS СКАУТ каждые 2 мин + daily-датчики 1×/сутки (как задумано).
 * На Mac mini после cutover: ENABLE_LOCAL_CRONS=0 и полный crontab (не копировать
 * урезанный vercel.json — вернуть все задуманные слоты).
 */

const SCOUT_INTERVAL_MS = 2 * 60 * 1000;
const SCOUT_DAILY_INTERVAL_MS = 60 * 60 * 1000; // проверка раз в час, пишет не чаще 1×/сутки
const START_DELAY_MS = 12_000;

type GlobalCrons = typeof globalThis & {
  __tradecomLocalCronsStarted?: boolean;
  __tradecomScoutCronTimer?: ReturnType<typeof setInterval>;
  __tradecomScoutDailyTimer?: ReturnType<typeof setInterval>;
  __tradecomScoutDailyLastYmd?: string;
};

function shouldRunLocalCrons(): boolean {
  if (process.env.VERCEL === '1') return false;
  if (process.env.ENABLE_LOCAL_CRONS === '0') return false;
  return true;
}

async function runScoutSync() {
  try {
    const { isScoutConfigured, syncScoutTelemetry } = await import('@/lib/integrations/scout');
    if (!isScoutConfigured()) {
      console.warn('[local-cron scout-sync] SCOUT_* не заданы — пропуск');
      return;
    }
    const result = await syncScoutTelemetry();
    // Успех молча — иначе каждые 2 мин засоряет терминал next dev.
    if (!result.ok) {
      console.warn(
        `[local-cron scout-sync] ok=false mapped=${result.mapped ?? 0} snapshots=${result.snapshotsUpdated ?? 0}`,
      );
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[local-cron scout-sync]', message);
  }
}

async function runScoutDailySensors() {
  try {
    const { isScoutConfigured, syncScoutDailySensors } = await import('@/lib/integrations/scout');
    const { todayMoscowYmd } = await import('@/lib/fleetService');
    if (!isScoutConfigured()) return;
    const ymd = todayMoscowYmd();
    const g = globalThis as GlobalCrons;
    if (g.__tradecomScoutDailyLastYmd === ymd) return;

    const result = await syncScoutDailySensors({ force: false });
    console.log(
      `[local-cron scout-sensors-daily] date=${result.readingDate} written=${result.written} skipped=${result.skipped} failed=${result.failed}`,
    );
    if (result.errors.length) {
      console.warn('[local-cron scout-sensors-daily] errors:', result.errors.slice(0, 5));
    }
    // День «закрыт» только если всё прошло и есть хотя бы одна запись
    // (или всё уже было skipped — тогда тоже ок, повторять нечего)
    if (result.failed === 0 && (result.written > 0 || result.skipped > 0) && result.processed > 0) {
      g.__tradecomScoutDailyLastYmd = ymd;
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[local-cron scout-sensors-daily]', message);
  }
}

/** Запуск из instrumentation.ts (один раз на процесс). */
export function startLocalCrons() {
  if (!shouldRunLocalCrons()) return;

  const g = globalThis as GlobalCrons;
  if (g.__tradecomLocalCronsStarted) return;
  g.__tradecomLocalCronsStarted = true;

  console.log(
    `[local-cron] включены (GPS ${SCOUT_INTERVAL_MS / 60_000} мин, датчики 1×/сутки). Выключить: ENABLE_LOCAL_CRONS=0`,
  );

  setTimeout(() => {
    void runScoutSync();
    void runScoutDailySensors();
    g.__tradecomScoutCronTimer = setInterval(() => {
      void runScoutSync();
    }, SCOUT_INTERVAL_MS);
    g.__tradecomScoutDailyTimer = setInterval(() => {
      void runScoutDailySensors();
    }, SCOUT_DAILY_INTERVAL_MS);
  }, START_DELAY_MS);
}
