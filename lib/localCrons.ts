/**
 * Локальные кроны для `next dev` / `next start` вне Vercel.
 *
 * На Vercel расписание — vercel.json (там process.env.VERCEL=1).
 * На ноутбуке / Mac mini без crontab — этот модуль дергает sync сам.
 *
 * Отключить: ENABLE_LOCAL_CRONS=0 в .env.local
 * (на Mac mini после cutover, если scout-sync уже в crontab — лучше выключить,
 * чтобы не дублировать запросы к СКАУТ).
 */

const SCOUT_INTERVAL_MS = 2 * 60 * 1000;
const START_DELAY_MS = 12_000;

type GlobalCrons = typeof globalThis & {
  __tradecomLocalCronsStarted?: boolean;
  __tradecomScoutCronTimer?: ReturnType<typeof setInterval>;
};

function shouldRunLocalCrons(): boolean {
  if (process.env.VERCEL === '1') return false;
  if (process.env.ENABLE_LOCAL_CRONS === '0') return false;
  // По умолчанию включено на любом не-Vercel процессе (dev / start на Mac)
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
    console.log(
      `[local-cron scout-sync] ok=${result.ok} mapped=${result.mapped ?? 0} snapshots=${result.snapshotsUpdated ?? 0}`,
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[local-cron scout-sync]', message);
  }
}

/** Запуск из instrumentation.ts (один раз на процесс). */
export function startLocalCrons() {
  if (!shouldRunLocalCrons()) return;

  const g = globalThis as GlobalCrons;
  if (g.__tradecomLocalCronsStarted) return;
  g.__tradecomLocalCronsStarted = true;

  console.log(
    `[local-cron] включены (интервал СКАУТ ${SCOUT_INTERVAL_MS / 60_000} мин). Выключить: ENABLE_LOCAL_CRONS=0`,
  );

  setTimeout(() => {
    void runScoutSync();
    g.__tradecomScoutCronTimer = setInterval(() => {
      void runScoutSync();
    }, SCOUT_INTERVAL_MS);
  }, START_DELAY_MS);
}
