import { NextRequest, NextResponse } from 'next/server';

/**
 * Защита Vercel Cron: без CRON_SECRET эндпоинт закрыт (401).
 * Vercel подставляет Authorization: Bearer <CRON_SECRET>.
 */
export function requireCronAuth(req: NextRequest): NextResponse | null {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) {
    console.error('[cron] CRON_SECRET не задан — отказ');
    return NextResponse.json(
      { error: 'Unauthorized', message: 'CRON_SECRET не настроен' },
      { status: 401 },
    );
  }
  if (req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return null;
}
