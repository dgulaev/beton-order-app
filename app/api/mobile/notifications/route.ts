import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// GET — активные уведомления только за сегодняшний день
export async function GET() {
  // Начало текущего дня по московскому времени (UTC+3)
  const now = new Date();
  const todayStart = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      // 00:00 МСК = 21:00 UTC предыдущего дня
      -3, 0, 0, 0
    )
  ).toISOString();

  const { data, error } = await supabase
    .from('mobile_notifications')
    .select('*')
    .is('dismissed_at', null)
    .gte('created_at', todayStart)
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, data: data ?? [] });
}

// DELETE — закрыть все (dismiss all)
export async function DELETE() {
  const { error } = await supabase
    .from('mobile_notifications')
    .update({ dismissed_at: new Date().toISOString() })
    .is('dismissed_at', null);

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
