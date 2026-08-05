/**
 * Server startup hook (Next.js).
 * На Vercel не поднимаем локальные кроны — там vercel.json.
 * На ноутбуке / Mac mini — lib/localCrons.ts (СКАУТ каждые 2 мин).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { startLocalCrons } = await import('./lib/localCrons');
  startLocalCrons();
}
