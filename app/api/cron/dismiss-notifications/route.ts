import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Vercel Cron Job — запускается каждый день в 00:01 МСК (21:01 UTC)
// Защита: Vercel автоматически подставляет Authorization: Bearer CRON_SECRET
// Несанкционированные запросы отклоняются с 401.
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Начало текущего дня по МСК: UTC+3 → вычитаем 3 часа из midnight UTC
  const todayStartMsk = new Date(
    Date.UTC(
      new Date().getUTCFullYear(),
      new Date().getUTCMonth(),
      new Date().getUTCDate(),
      -3, 0, 0, 0
    )
  ).toISOString();

  const { error, count } = await supabase
    .from('mobile_notifications')
    .update({ dismissed_at: new Date().toISOString() })
    .is('dismissed_at', null)
    .lt('created_at', todayStartMsk);

  if (error) {
    console.error('[Cron] dismiss-notifications error:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  console.log(`[Cron] dismiss-notifications: закрыто ${count ?? 0} записей за прошлые дни`);
  return NextResponse.json({ success: true, dismissed: count ?? 0 });
}
